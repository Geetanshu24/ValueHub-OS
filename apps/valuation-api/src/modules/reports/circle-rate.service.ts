import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AiService } from '../ai/ai.service.js';

// Only pages on these domains are used: the governments' own sites.
const OFFICIAL_DOMAINS = ['gov.in', 'nic.in'];

export interface CircleRate {
  found: boolean;
  areaName: string;
  category: string;
  rateText: string;
  ratePerSqm: number | null;
  effective: string;
  sourceUrl: string;
  sourceTitle: string;
  quote: string;
  notes: string;
}

export const isOfficial = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) && OFFICIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

// Finds the circle (guideline) rate for a property on the government's own pages, and records where it came
// from. Nothing is trusted: the answer is a suggestion with its source link, and the valuer checks it.
@Injectable()
export class CircleRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  private async load(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { id: true, code: true, valuationDate: true, property: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  async lookup(firmId: string, assignmentId: string): Promise<CircleRate> {
    const { property: p, valuationDate } = await this.load(firmId, assignmentId);
    if (!p.state || !p.district) throw new BadRequestException('Add the state and district of the property first');
    const place = [p.unitDetail, p.addressLine, p.locality, p.village, p.tehsil && `tehsil ${p.tehsil}`, `district ${p.district}`, p.state, p.pinCode].filter(Boolean).join(', ');
    const answer = await this.ai.json<{ found: boolean; area_name: string; category: string; rate_text: string; rate_per_sqm: number | null; effective: string; source_url: string; source_title: string; quote: string; notes: string }>({
      system:
        'You find the official circle rate (also called guideline value, collector rate or DLC rate) for a property in India, to put in a bank valuation report. Use only pages of the government\'s own websites (the state revenue, registration and stamps department or the municipal authority). Find the rate for the property\'s own area or colony and the property class, and the year in force. Copy the rate exactly as the page prints it, with its unit. In "quote" copy the short line from the page that shows the rate. Give the full address of the page you read as source_url. If you cannot find the rate for this area on an official page, set found to false and explain in notes. Never estimate, never use a news site or a property portal, never give a rate for a different area.',
      content: [{ type: 'text', text: `Property class: ${p.propertyClass}\nProperty: ${place}\nValuation date: ${valuationDate.toISOString().slice(0, 10)}\n\nGive the rate per square metre as a number in rate_per_sqm only when the page states it per sq m, or per sq yd or sq ft so that it can be converted exactly; otherwise null.` }],
      schema: {
        type: 'object',
        properties: { found: { type: 'boolean' }, area_name: { type: 'string' }, category: { type: 'string' }, rate_text: { type: 'string' }, rate_per_sqm: { type: ['number', 'null'] }, effective: { type: 'string' }, source_url: { type: 'string' }, source_title: { type: 'string' }, quote: { type: 'string' }, notes: { type: 'string' } },
        required: ['found', 'area_name', 'category', 'rate_text', 'rate_per_sqm', 'effective', 'source_url', 'source_title', 'quote', 'notes'],
        additionalProperties: false,
      },
      web: { domains: OFFICIAL_DOMAINS },
    });
    const clean = (v: unknown, n = 300) => String(v ?? '').trim().slice(0, n);
    const rate = typeof answer.rate_per_sqm === 'number' && Number.isFinite(answer.rate_per_sqm) && answer.rate_per_sqm > 0 && answer.rate_per_sqm < 100_000_000 ? Math.round(answer.rate_per_sqm * 100) / 100 : null;
    const result: CircleRate = { found: !!answer.found, areaName: clean(answer.area_name), category: clean(answer.category), rateText: clean(answer.rate_text, 200), ratePerSqm: rate, effective: clean(answer.effective, 60), sourceUrl: clean(answer.source_url, 500), sourceTitle: clean(answer.source_title), quote: clean(answer.quote, 400), notes: clean(answer.notes, 500) };
    if (result.found && (!result.rateText || !isOfficial(result.sourceUrl))) {
      return { ...result, found: false, notes: `${result.notes ? `${result.notes} ` : ''}No rate was taken: the source given was not an official government page.`.trim() };
    }
    return result;
  }

  // Keeps the rate and where it came from: a source note in the case's documents (to enclose with the report),
  // the rate as a fact the report boxes fill from, and a line in the rate bank.
  async apply(firmId: string, actorId: string, assignmentId: string, given: Partial<CircleRate>) {
    const { code, property: p } = await this.load(firmId, assignmentId);
    const rateText = String(given.rateText ?? '').trim().slice(0, 200);
    const sourceUrl = String(given.sourceUrl ?? '').trim().slice(0, 500);
    if (!rateText || !isOfficial(sourceUrl)) throw new BadRequestException('A rate and an official government page (gov.in or nic.in) are needed');
    const text = (v: unknown, n = 300) => String(v ?? '').trim().slice(0, n);
    const note = { areaName: text(given.areaName), category: text(given.category), effective: text(given.effective, 60), sourceTitle: text(given.sourceTitle), quote: text(given.quote, 400), notes: text(given.notes, 500) };
    const ratePerSqm = typeof given.ratePerSqm === 'number' && given.ratePerSqm > 0 && given.ratePerSqm < 100_000_000 ? given.ratePerSqm : null;
    const retrieved = new Date();
    const picture = this.sourceNote({ code, address: p.addressLine, rateText, sourceUrl, retrieved, ...note });
    const stored = await this.storage.save(firmId, picture);
    const detail = [note.category, note.areaName, note.effective].filter(Boolean).join(', ');
    const value = `${rateText}${detail ? ` (${detail})` : ''}. Source: ${note.sourceTitle || new URL(sourceUrl).hostname}, ${sourceUrl}`;

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: { firmId, propertyId: p.id, assignmentId, type: 'CIRCLE_RATE_COPY', source: 'DASHBOARD', fileName: `Circle-rate-source-${code.replaceAll('/', '-')}.png`, mimeType: 'image/png', sizeBytes: stored.sizeBytes, pageCount: 1, storageKey: stored.storageKey, sha256: stored.sha256, uploadedById: actorId },
        select: { id: true, fileName: true },
      });
      await tx.extractedField.create({
        data: { firmId, documentId: created.id, fieldKey: 'guideline_rate', extractedValue: value, pageNumber: 1, confidence: 0.6, source: 'OCR', state: 'UNVERIFIED', note: 'Found on the government site by the AI; check it against the page before relying on it' },
      });
      if (ratePerSqm) {
        await tx.marketRate.create({
          data: { firmId, locality: p.locality || p.village || p.addressLine.slice(0, 120), propertyClass: p.propertyClass, kind: 'CIRCLE', rate: ratePerSqm, unit: 'SQ_M', ratePerSqm, observedOn: new Date(retrieved.toISOString().slice(0, 10)), source: sourceUrl, detail: [note.category, note.areaName, note.effective].filter(Boolean).join(' · ') || null, recordedById: actorId },
        });
      }
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'circle_rate.recorded', metadata: { sourceUrl, documentId: created.id } }, tx);
      return created;
    });
    return { documentId: document.id, fileName: document.fileName, value };
  }

  // The source note as a picture, so it can be placed in the report beside the guideline rate.
  private sourceNote(n: { code: string; address: string; rateText: string; sourceUrl: string; retrieved: Date; areaName: string; category: string; effective: string; sourceTitle: string; quote: string; notes: string }): Buffer {
    const W = 1000;
    const rows: [string, string][] = [['Circle rate', n.rateText], ['Category', n.category], ['Area or colony on the list', n.areaName], ['In force from', n.effective], ['Taken from', n.sourceTitle], ['Page address', n.sourceUrl], ['Line on the page', n.quote ? `"${n.quote}"` : ''], ['Found on', `${n.retrieved.toISOString().replace('T', ' ').slice(0, 16)} UTC`], ['Notes', n.notes]];
    const measure = createCanvas(W, 10).getContext('2d');
    const wrap = (text: string, font: string, width: number) => {
      measure.font = font;
      const lines: string[] = [];
      let line = '';
      // Long page addresses have no spaces, so they are cut by width too.
      for (const word of text.split(/(?<=[\s/&?=])/)) {
        if (measure.measureText(line + word).width > width && line) { lines.push(line.trimEnd()); line = word; } else line += word;
      }
      if (line.trim()) lines.push(line.trimEnd());
      return lines;
    };
    const body = rows.filter(([, v]) => v).map(([label, value]) => ({ label, lines: wrap(value, '20px Helvetica, Arial, sans-serif', W - 80) }));
    const foot = wrap('Found on the government site by an AI search and kept here so the valuer can open the page and check it. It is not a certified copy of the official list.', 'italic 15px Helvetica, Arial, sans-serif', W - 80);
    const height = 130 + body.reduce((t, r) => t + 26 + r.lines.length * 27 + 12, 0) + foot.length * 21 + 40;
    const canvas = createCanvas(W, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, height);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, height - 20);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 28px Helvetica, Arial, sans-serif';
    ctx.fillText('Circle rate: source note', 40, 62);
    ctx.fillStyle = '#555';
    ctx.font = '16px Helvetica, Arial, sans-serif';
    ctx.fillText(`Case ${n.code} · ${n.address}`.slice(0, 110), 40, 92);
    let y = 134;
    for (const row of body) {
      ctx.fillStyle = '#6b7280';
      ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
      ctx.fillText(row.label.toUpperCase(), 40, y);
      y += 26;
      ctx.fillStyle = '#111';
      ctx.font = '20px Helvetica, Arial, sans-serif';
      for (const line of row.lines) { ctx.fillText(line, 40, y); y += 27; }
      y += 12;
    }
    ctx.fillStyle = '#555';
    ctx.font = 'italic 15px Helvetica, Arial, sans-serif';
    for (const line of foot) { ctx.fillText(line, 40, y + 10); y += 21; }
    return canvas.toBuffer('image/png');
  }
}
