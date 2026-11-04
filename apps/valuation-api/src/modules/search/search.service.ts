import { BadRequestException, Injectable } from '@nestjs/common';
import type { Paginated } from '@value-hub/valuation-shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SearchQuery } from './search.dto.js';

const resultSelect = {
  id: true,
  code: true,
  status: true,
  purpose: true,
  valuationDate: true,
  dueDate: true,
  bank: { select: { name: true } },
  branch: { select: { name: true } },
  assignedValuer: { select: { fullName: true } },
  property: { select: { id: true, code: true, addressLine: true, propertyClass: true, district: true } },
} satisfies Prisma.AssignmentSelect;

interface DocumentHit {
  propertyId: string;
  documentId: string;
  fileName: string;
  snippet: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  // Every result is filtered by firm (and, for inspectors, by their own
  // visits) before anything is returned, and document snippets are only ever
  // produced from the same firm's documents.
  async search(user: AuthUser, query: SearchQuery): Promise<Paginated<unknown> & { documentHits: Record<string, DocumentHit[]> }> {
    const q = query.q?.trim();
    if (query.dateField && !query.from && !query.to) throw new BadRequestException('dateField needs from and/or to');

    const hits = q ? await this.documentHits(user, q) : [];
    const hitProperties = [...new Set(hits.map((h) => h.propertyId))];

    const range = (query.from || query.to) && {
      ...(query.from && { gte: new Date(query.from) }),
      ...(query.to && { lte: new Date(`${query.to}T23:59:59.999Z`) }),
    };
    const dateFilter: Prisma.AssignmentWhereInput = !range
      ? {}
      : ({
          received: { receivedAt: range },
          valuation: { valuationDate: range },
          due: { dueDate: range },
          inspection: { inspections: { some: { visitedAt: range } } },
          submission: { submissions: { some: { sentAt: range } } },
          invoice: { invoices: { some: { issuedOn: range } } },
        }[query.dateField ?? 'received'] as Prisma.AssignmentWhereInput);

    const where: Prisma.AssignmentWhereInput = {
      firmId: user.firmId,
      ...(user.role === 'INSPECTOR' && { inspections: { some: { inspectorId: user.userId } } }),
      ...(query.bankId && { bankId: query.bankId }),
      ...(query.branchId && { branchId: query.branchId }),
      ...(query.assignedValuerId && { assignedValuerId: query.assignedValuerId }),
      ...(query.status && { status: query.status }),
      property: {
        ...(query.propertyClass && { propertyClass: query.propertyClass }),
        ...(query.district && { district: { equals: query.district, mode: 'insensitive' } }),
        ...(query.tehsil && { tehsil: { equals: query.tehsil, mode: 'insensitive' } }),
        ...(query.village && { village: { equals: query.village, mode: 'insensitive' } }),
        ...(query.pinCode && { pinCode: query.pinCode }),
        ...(query.documentType && { documents: { some: { type: query.documentType } } }),
      },
      AND: [
        dateFilter,
        ...(q
          ? [
              {
                OR: [
                  { code: { contains: q, mode: 'insensitive' } },
                  { purpose: { contains: q, mode: 'insensitive' } },
                  { bank: { name: { contains: q, mode: 'insensitive' } } },
                  { branch: { name: { contains: q, mode: 'insensitive' } } },
                  { property: { code: { contains: q, mode: 'insensitive' } } },
                  { property: { addressLine: { contains: q, mode: 'insensitive' } } },
                  { property: { locality: { contains: q, mode: 'insensitive' } } },
                  { property: { village: { contains: q, mode: 'insensitive' } } },
                  { property: { district: { contains: q, mode: 'insensitive' } } },
                  { property: { khasraNumbers: { has: q } } },
                  ...(hitProperties.length ? [{ propertyId: { in: hitProperties } }] : []),
                ],
              } satisfies Prisma.AssignmentWhereInput,
            ]
          : []),
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({ where, select: resultSelect, orderBy: [{ receivedAt: 'desc' }], ...skipTake(query) }),
      this.prisma.assignment.count({ where }),
    ]);

    // Snippets only for properties that appear in this page of results.
    const visible = new Set(items.map((i) => i.property.id));
    const documentHits: Record<string, DocumentHit[]> = {};
    for (const hit of hits) if (visible.has(hit.propertyId)) (documentHits[hit.propertyId] ??= []).push(hit);
    return { items, total, page: query.page, pageSize: query.pageSize, documentHits };
  }

  // Full-text match over document text, restricted to the caller's firm and,
  // for inspectors, to properties they have visited.
  private async documentHits(user: AuthUser, q: string): Promise<DocumentHit[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; propertyId: string; fileName: string; snippet: string }[]>`
      SELECT d.id, d."propertyId", d."fileName",
             ts_headline('simple', d."ocrText", plainto_tsquery('simple', ${q}), 'MaxFragments=1, MaxWords=18, MinWords=5, StartSel=«, StopSel=»') AS snippet
      FROM "Document" d
      WHERE d."firmId" = ${user.firmId}
        AND to_tsvector('simple', coalesce(d."ocrText", '')) @@ plainto_tsquery('simple', ${q})
        AND (${user.role !== 'INSPECTOR'} OR EXISTS (
          SELECT 1 FROM "Assignment" a JOIN "Inspection" i ON i."assignmentId" = a.id
          WHERE a."propertyId" = d."propertyId" AND i."inspectorId" = ${user.userId}))
      LIMIT 200`;
    return rows.map((r) => ({ propertyId: r.propertyId, documentId: r.id, fileName: r.fileName, snippet: r.snippet }));
  }
}
