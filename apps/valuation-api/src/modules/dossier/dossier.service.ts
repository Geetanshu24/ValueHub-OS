import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RedactionDto } from './dossier.dto.js';

export interface PlanItem {
  id: string;
  group: string;
  label: string;
  // Might carry fees, coordinates or internal notes; the reviewer decides.
  sensitive?: 'fees' | 'gps' | 'internal';
}

const MAX_DOSSIER_BYTES = 150 * 1024 * 1024;
const DISCLAIMER =
  'This archive collects records held about one assignment. It does not prove title, certify any value, or guarantee a legal outcome. Each file is listed with its SHA-256 so later changes can be detected; a hash does not prove a document is true.';

const safe = (name: string) => name.replace(/[^\w.\- ()]/g, '_').slice(0, 120);
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2));

interface Entry {
  path: string;
  data: Buffer;
  source: string;
}

@Injectable()
export class DossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // What can go into a dossier, so the person exporting can choose and see
  // what is sensitive before anything is built.
  async plan(firmId: string, assignmentId: string): Promise<PlanItem[]> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: {
        code: true,
        property: { select: { documents: { select: { id: true, type: true, fileName: true }, orderBy: { uploadedAt: 'desc' }, take: 200 } } },
        reports: { select: { id: true, versionNumber: true, status: true }, orderBy: { versionNumber: 'desc' } },
        valuations: { select: { id: true, versionNumber: true, status: true }, orderBy: { versionNumber: 'desc' } },
        inspections: { select: { id: true, visitedAt: true, status: true }, orderBy: { visitedAt: 'desc' } },
        _count: { select: { comparables: true, discrepancies: true, queries: true, submissions: true, invoices: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const items: PlanItem[] = [
      ...assignment.reports.map((r) => ({ id: `report:${r.id}`, group: 'Reports', label: `Report R${r.versionNumber} (${r.status.toLowerCase()})` })),
      ...assignment.valuations.map((v) => ({ id: `valuation:${v.id}`, group: 'Calculations', label: `Valuation V${v.versionNumber} workings (${v.status.toLowerCase()})` })),
      ...assignment.inspections.map((i) => ({ id: `inspection:${i.id}`, group: 'Inspection', label: `Visit ${i.visitedAt.toISOString().slice(0, 10)} with photographs (${i.status.toLowerCase()})`, sensitive: 'gps' as const })),
      ...assignment.property.documents.map((d) => ({ id: `document:${d.id}`, group: 'Source documents', label: `${d.type.replaceAll('_', ' ').toLowerCase()}: ${d.fileName}` })),
    ];
    const c = assignment._count;
    if (c.comparables) items.push({ id: 'comparables', group: 'Evidence', label: `Market comparables (${c.comparables})` });
    if (c.discrepancies) items.push({ id: 'discrepancies', group: 'Evidence', label: `Differences between records (${c.discrepancies})` });
    if (c.queries) items.push({ id: 'queries', group: 'Correspondence', label: `Bank queries and responses (${c.queries})`, sensitive: 'internal' });
    if (c.submissions) items.push({ id: 'submissions', group: 'Correspondence', label: `Submission log (${c.submissions})` });
    if (c.invoices) items.push({ id: 'invoices', group: 'Accounts', label: `Invoices and payments (${c.invoices})`, sensitive: 'fees' });
    items.push({ id: 'audit', group: 'Trail', label: 'Audit trail', sensitive: 'internal' });
    return items;
  }

  async build(firmId: string, actor: { userId: string }, assignmentId: string, itemIds: string[], redact: RedactionDto = {}) {
    const plan = await this.plan(firmId, assignmentId);
    const known = new Map(plan.map((p) => [p.id, p]));
    const unknown = itemIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new BadRequestException(`Not part of this assignment: ${unknown.join(', ')}`);

    // Redaction wins over selection: an item the reviewer chose to withhold is dropped.
    const dropped: string[] = [];
    const selected = [...new Set(itemIds)].filter((id) => {
      const sensitive = known.get(id)?.sensitive;
      const withheld = (redact.fees && sensitive === 'fees') || (redact.internal && sensitive === 'internal');
      if (withheld) dropped.push(id);
      return !withheld;
    });
    if (selected.length === 0) throw new BadRequestException('Nothing is left to export after the redactions chosen');

    const entries: Entry[] = [];
    for (const id of selected) entries.push(...(await this.collect(firmId, assignmentId, id, redact)));

    const total = entries.reduce((t, e) => t + e.data.length, 0);
    if (total > MAX_DOSSIER_BYTES) throw new BadRequestException('The selection is too large to export in one archive; deselect some items');

    const assignment = await this.prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { code: true, property: { select: { code: true } } } });
    const exporter = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } });
    const files = entries.map((e) => ({ path: e.path, bytes: e.data.length, sha256: createHash('sha256').update(e.data).digest('hex'), source: e.source }));
    const manifest = {
      assignment: assignment.code,
      property: assignment.property.code,
      generatedAt: new Date().toISOString(),
      generatedBy: exporter?.fullName ?? actor.userId,
      redactions: { fees: Boolean(redact.fees), gps: Boolean(redact.gps), internal: Boolean(redact.internal), withheldItems: dropped },
      disclaimer: DISCLAIMER,
      files,
    };
    const index = [
      `EVIDENCE DOSSIER — ${assignment.code} (${assignment.property.code})`,
      `Generated ${manifest.generatedAt} by ${manifest.generatedBy}`,
      '',
      'CONTENTS',
      ...files.map((f) => `  ${f.path}  (${f.bytes} bytes, sha256 ${f.sha256.slice(0, 16)}…)`),
      '',
      `REDACTIONS: fees ${manifest.redactions.fees ? 'removed' : 'kept'}; GPS ${manifest.redactions.gps ? 'removed' : 'kept'}; internal notes ${manifest.redactions.internal ? 'removed' : 'kept'}`,
      '',
      DISCLAIMER,
    ].join('\n');

    const zip = await this.zip([{ path: '00_INDEX.txt', data: Buffer.from(index), source: 'index' }, { path: 'manifest.json', data: json(manifest), source: 'manifest' }, ...entries]);
    await this.audit.record({
      firmId,
      actorId: actor.userId,
      entityType: 'Assignment',
      entityId: assignmentId,
      action: 'dossier.exported',
      metadata: { items: selected, withheld: dropped, redactions: manifest.redactions, files: files.length, sha256: createHash('sha256').update(zip).digest('hex') },
    });
    return { fileName: `${assignment.code}-dossier.zip`, buffer: zip };
  }

  private async collect(firmId: string, assignmentId: string, id: string, redact: RedactionDto): Promise<Entry[]> {
    const [kind, ref] = id.split(':');
    switch (kind) {
      case 'report': {
        const r = await this.prisma.reportVersion.findFirstOrThrow({ where: { id: ref, firmId, assignmentId }, select: { versionNumber: true, status: true, storageKey: true } });
        return [{ path: `reports/R${r.versionNumber}-${r.status.toLowerCase()}.pdf`, data: await this.storage.read(r.storageKey), source: id }];
      }
      case 'valuation': {
        const v = await this.prisma.valuationVersion.findFirstOrThrow({ where: { id: ref, firmId, assignmentId }, include: { lineItems: { orderBy: { sortOrder: 'asc' } } } });
        const { createdById: _c, approvedById: _a, ...rest } = v;
        return [{ path: `valuation/V${v.versionNumber}.json`, data: json(rest), source: id }];
      }
      case 'inspection': {
        const i = await this.prisma.inspection.findFirstOrThrow({ where: { id: ref, firmId, assignmentId }, include: { measurements: true, photos: true, inspector: { select: { fullName: true } } } });
        const day = i.visitedAt.toISOString().slice(0, 10);
        const { photos, ...data } = i;
        const record = { ...data, ...(redact.gps && { latitude: null, longitude: null }), photos: photos.map((p) => ({ id: p.id, caption: p.caption, captionConfirmed: p.captionConfirmed, sha256: p.sha256 })) };
        const entries: Entry[] = [{ path: `inspection/${day}/inspection.json`, data: json(record), source: id }];
        for (const [n, p] of photos.entries()) {
          entries.push({ path: `inspection/${day}/photos/${String(n + 1).padStart(2, '0')}-${safe(p.caption ?? 'photo')}.${p.mimeType === 'image/png' ? 'png' : p.mimeType === 'image/webp' ? 'webp' : 'jpg'}`, data: await this.storage.read(p.storageKey), source: id });
        }
        return entries;
      }
      case 'document': {
        const d = await this.prisma.document.findFirstOrThrow({ where: { id: ref, firmId, property: { assignments: { some: { id: assignmentId } } } }, include: { fields: true } });
        return [
          { path: `documents/${d.type.toLowerCase()}-${safe(d.fileName)}`, data: await this.storage.read(d.storageKey), source: id },
          { path: `documents/${d.type.toLowerCase()}-${safe(d.fileName)}.facts.json`, data: json(d.fields.map((f) => ({ fieldKey: f.fieldKey, value: f.verifiedValue ?? f.extractedValue, originallyRead: f.extractedValue, page: f.pageNumber, state: f.state, source: f.source }))), source: id },
        ];
      }
      case 'comparables':
        return [{ path: 'evidence/comparables.json', data: json(await this.prisma.marketComparable.findMany({ where: { assignmentId, firmId }, take: 200 })), source: id }];
      case 'discrepancies':
        return [{ path: 'evidence/discrepancies.json', data: json(await this.prisma.discrepancy.findMany({ where: { assignmentId, firmId }, take: 200 })), source: id }];
      case 'queries': {
        const queries = await this.prisma.bankQuery.findMany({ where: { assignmentId, firmId }, take: 200 });
        return [{ path: 'correspondence/queries.json', data: json(queries), source: id }];
      }
      case 'submissions':
        return [{ path: 'correspondence/submissions.json', data: json(await this.prisma.submission.findMany({ where: { assignmentId, firmId }, take: 200 })), source: id }];
      case 'invoices':
        return [{ path: 'accounts/invoices.json', data: json(await this.prisma.invoice.findMany({ where: { assignmentId, firmId }, include: { payments: true }, take: 200 })), source: id }];
      case 'audit': {
        const events = await this.prisma.auditEvent.findMany({ where: { firmId, OR: [{ entityId: assignmentId }, { entityType: 'ReportVersion', entityId: { in: (await this.prisma.reportVersion.findMany({ where: { assignmentId }, select: { id: true } })).map((r) => r.id) } }] }, orderBy: { createdAt: 'asc' }, take: 1000 });
        return [{ path: 'trail/audit.json', data: json(events), source: id }];
      }
      default:
        throw new BadRequestException(`Unknown item ${id}`);
    }
  }

  private zip(entries: Entry[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const sink = new PassThrough();
      const chunks: Buffer[] = [];
      sink.on('data', (c: Buffer) => chunks.push(c));
      sink.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.pipe(sink);
      for (const entry of entries) archive.append(entry.data, { name: entry.path });
      void archive.finalize();
    });
  }
}
