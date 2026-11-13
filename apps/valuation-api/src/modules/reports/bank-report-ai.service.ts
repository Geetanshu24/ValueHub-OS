import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { imageBlock, toJpegBase64 } from '../ai/images.js';
import { BankReportService } from './bank-report.service.js';
import { checkReport, type Issue } from './report-check.js';

// The wording boxes the AI may draft, and what each one is for.
const DRAFTABLE: Record<string, string> = {
  property_description: 'Brief description of the property: freehold or leasehold, type, area, and where it is.',
  market_opinion: "The valuer's paragraph on the rate adopted: the dealers' range and the rate adopted for valuation, using only the numbers given.",
  socio: 'Description of the location in terms of social structure, economic level and the neighbourhood.',
  site_development: 'Development of the surrounding areas (roads, sewer, market).',
  surrounding_development: 'Development of the surrounding areas.',
  site_advantage: 'Advantage of the site.',
  site_amenities: 'Civic amenities (school, hospital, bus stop, market) and how far.',
  in_social: 'Social infrastructure: schools, medical facilities, parks, and how far.',
  mk_location: 'Marketability: locational attributes of the property.',
  mk_scarcity: 'Marketability: how scarce or available similar property is.',
  mk_demand: 'Marketability: demand and supply of this kind of property.',
  tp_12: 'Comment on surrounding land uses and adjoining properties.',
  val_difference_note: 'Why the market value differs from the circle rate (only if the numbers show a difference).',
  as_resale: 'Remark on resale instances compared with the circle rate.',
};

// What a photograph can show, and the form boxes each answer goes to (only those in the chosen bank's form are used).
const PHOTO_ITEMS: Record<string, { what: string; keys: string[] }> = {
  plot_shape: { what: 'Shape of the plot (rectangular, irregular...)', keys: ['site_shape'] },
  corner_plot: { what: 'Whether it is a corner plot or an intermittent plot', keys: ['site_corner'] },
  road_surface: { what: 'Type of road in front (paved, kachha...)', keys: ['site_road_type', 'road_type'] },
  compound_wall: { what: 'Whether a compound wall is present', keys: ['cw_present'] },
  construction_stage: { what: 'Whether the building is complete, under construction or a vacant plot', keys: ['construction_stage'] },
  building_condition: { what: 'Visible condition / appearance of the building (excellent, good, normal, poor)', keys: ['b_condition_exterior', 'en_appearance'] },
  surroundings: { what: 'Whether the surrounding area looks developed', keys: ['site_development', 'surrounding_development'] },
  occupancy: { what: 'Whether the property looks occupied or vacant', keys: ['occupancy'] },
};

export interface Draft {
  key: string;
  label: string;
  text: string;
  basis: string;
}

const MAX_PHOTOS = 8;

export interface MismatchItem {
  key: string;
  label: string;
  status: string;
  document: string;
  site: string;
  verdict: 'likely_document' | 'likely_site' | 'needs_check';
  explanation: string;
  check: string;
}

@Injectable()
export class BankReportAiService {
  constructor(
    private readonly reports: BankReportService,
    private readonly ai: AiService,
  ) {}

  enabled() {
    return this.ai.enabled();
  }

  // Checks that need no AI.
  async check(firmId: string, assignmentId: string, requested?: string): Promise<{ issues: Issue[] }> {
    const ctx = await this.reports.merged(firmId, assignmentId, requested);
    return { issues: checkReport({ fields: ctx.format.fields, values: ctx.values, documentFacts: ctx.documentFacts, realizableShare: ctx.format.id === 'SBI' ? 0.95 : 0.9 }) };
  }

  // A second reader: finds contradictions between boxes and documents that fixed rules would not.
  async review(firmId: string, assignmentId: string, requested?: string): Promise<{ issues: Issue[] }> {
    const ctx = await this.reports.merged(firmId, assignmentId, requested);
    const answers = Object.fromEntries(ctx.format.fields.filter((f) => !f.hidden && ctx.values[f.key]?.trim()).map((f) => [f.label.slice(0, 80), ctx.values[f.key]]));
    const result = await this.ai.json<{ issues: { message: string; severity: 'warn' | 'info' }[] }>({
      system:
        "You check an Indian property valuation report before it goes to the bank. Find real problems only: answers that contradict each other or the documents, figures that do not add up, wording that does not fit the property (for example a building described on a vacant plot), and important answers that are missing. Do not comment on style. Do not repeat what is merely empty. Return at most 10 issues, each one sentence.",
      content: [{ type: 'text', text: `Bank format: ${ctx.format.label}\nProperty class: ${ctx.propertyClass}\n\nAnswers in the report:\n${JSON.stringify(answers, null, 1)}\n\nFacts read from the documents:\n${JSON.stringify(ctx.documentFacts, null, 1)}` }],
      schema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { message: { type: 'string' }, severity: { type: 'string', enum: ['warn', 'info'] } }, required: ['message', 'severity'], additionalProperties: false } } }, required: ['issues'], additionalProperties: false },
    });
    return { issues: result.issues.slice(0, 10) };
  }

  // Where the documents and the inspector's site notes disagree or leave a gap: what each difference probably
  // means and what to check, using the rows the Compare page already shows. Nothing is decided or saved.
  async mismatches(firmId: string, assignmentId: string): Promise<{ summary: { match: number; differs: number; missing: number; open: number }; items: MismatchItem[]; visit: boolean }> {
    const data = await this.reports.compare(firmId, assignmentId);
    const rows = data.rows.filter((r) => (r.status === 'differs' || r.status === 'document_only' || r.status === 'site_only') && !(r.decision && !r.decision.stale));
    if (!data.visit || rows.length === 0) return { summary: data.summary, items: [], visit: !!data.visit };
    const keys = rows.map((r) => r.key);
    const result = await this.ai.json<{ items: { key: string; verdict: 'likely_document' | 'likely_site' | 'needs_check'; explanation: string; check: string }[] }>({
      system:
        "You compare what a property's documents say with what the inspector found on site, for an Indian bank valuation report. For each row say which side is more likely right and why, in one or two plain sentences, and the one thing the valuer should check or ask for. Use only the values given. Treat small wording differences, units and abbreviations as the same thing. Never decide for the valuer: use 'needs_check' when the values do not settle it.",
      content: [{ type: 'text', text: `Rows:\n${JSON.stringify(rows.map((r) => ({ key: r.key, label: r.label, status: r.status, as_per_documents: r.document, each_document: r.fromDocuments, as_per_site: r.site, note: r.note })), null, 1)}` }],
      schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: keys }, verdict: { type: 'string', enum: ['likely_document', 'likely_site', 'needs_check'] }, explanation: { type: 'string' }, check: { type: 'string' } }, required: ['key', 'verdict', 'explanation', 'check'], additionalProperties: false } } }, required: ['items'], additionalProperties: false },
    });
    const items = (result.items ?? []).filter((i) => keys.includes(i.key) && i.explanation.trim()).map((i) => {
      const row = rows.find((r) => r.key === i.key)!;
      return { key: i.key, label: row.label, status: row.status, document: row.document, site: row.site, verdict: i.verdict, explanation: i.explanation.trim(), check: i.check.trim() };
    });
    return { summary: data.summary, items, visit: true };
  }

  // Drafts wording for the boxes that are text rather than facts, from what the report already holds.
  async draft(firmId: string, assignmentId: string, requested?: string, keys?: string[]): Promise<{ drafts: Draft[] }> {
    const ctx = await this.reports.merged(firmId, assignmentId, requested);
    const known = new Set(ctx.format.keys);
    const wanted = (keys?.length ? keys : Object.keys(DRAFTABLE).filter((k) => !ctx.values[k]?.trim())).filter((k) => k in DRAFTABLE && known.has(k));
    if (wanted.length === 0) return { drafts: [] };
    const label = (key: string) => ctx.format.fields.find((f) => f.key === key)?.label ?? key;
    const given = Object.fromEntries(ctx.format.fields.filter((f) => !f.hidden && ctx.values[f.key]?.trim() && !(f.key in DRAFTABLE)).map((f) => [f.label.slice(0, 70), ctx.values[f.key].slice(0, 400)]));
    const result = await this.ai.json<{ drafts: { key: string; text: string; basis: string }[] }>({
      system:
        'You help an Indian property valuer write the wording boxes of a bank valuation report. Write in plain, professional valuation English, in the style of short report entries (one to three sentences). Use only the facts supplied. Never invent rates, distances, names, dates or amenities. If the facts do not support an entry, return an empty text for it. In "basis" say in a few words which supplied facts you used.',
      content: [{ type: 'text', text: `Boxes to write:\n${wanted.map((k) => `- ${k}: ${DRAFTABLE[k]}`).join('\n')}\n\nFacts already in the report:\n${JSON.stringify(given, null, 1)}\n\nFacts read from the documents:\n${JSON.stringify(ctx.facts, null, 1)}` }],
      schema: { type: 'object', properties: { drafts: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: wanted }, text: { type: 'string' }, basis: { type: 'string' } }, required: ['key', 'text', 'basis'], additionalProperties: false } } }, required: ['drafts'], additionalProperties: false },
    });
    return { drafts: result.drafts.filter((d) => d.text.trim() && wanted.includes(d.key)).map((d) => ({ ...d, label: label(d.key), text: d.text.trim() })) };
  }

  // Reads the inspection photographs for what they show. The valuer decides what is true of the site.
  async photos(firmId: string, assignmentId: string, requested?: string): Promise<{ suggestions: Draft[] }> {
    const ctx = await this.reports.merged(firmId, assignmentId, requested);
    const photos = (await this.reports.photos(firmId, ctx.inspectionId)).slice(0, MAX_PHOTOS);
    if (photos.length === 0) return { suggestions: [] };
    const known = new Set(ctx.format.keys);
    const items = Object.keys(PHOTO_ITEMS);
    const content = [
      { type: 'text' as const, text: `These are ${photos.length} photographs taken at the site visit of a ${ctx.propertyClass.toLowerCase()} property. For each item below, say what the photographs show. Leave out an item the photographs do not show clearly.\n\nItems:\n${items.map((k) => `- ${k}: ${PHOTO_ITEMS[k].what}`).join('\n')}` },
      ...(await Promise.all(photos.map(async (p, i) => [{ type: 'text' as const, text: `Photo ${i + 1}${p.caption ? ` (${p.caption})` : ''}` }, imageBlock(await toJpegBase64(p.data))]))).flat(),
    ];
    const result = await this.ai.json<{ observations: { item: string; value: string; evidence: string }[] }>({
      system: 'You assist a property valuer by reading site photographs. Report only what is visible. Do not guess what you cannot see. Keep each value to a few words, in the vocabulary of a valuation report.',
      content,
      schema: { type: 'object', properties: { observations: { type: 'array', items: { type: 'object', properties: { item: { type: 'string', enum: items }, value: { type: 'string' }, evidence: { type: 'string' } }, required: ['item', 'value', 'evidence'], additionalProperties: false } } }, required: ['observations'], additionalProperties: false },
    });
    const out: Draft[] = [];
    for (const o of result.observations) {
      if (!o.value.trim() || !(o.item in PHOTO_ITEMS)) continue;
      for (const key of PHOTO_ITEMS[o.item].keys) {
        if (known.has(key)) out.push({ key, label: ctx.format.fields.find((f) => f.key === key)?.label ?? key, text: o.value.trim(), basis: o.evidence });
      }
    }
    return { suggestions: out };
  }
}
