import { Injectable, NotFoundException } from '@nestjs/common';
import { OBSERVATION_SECTIONS } from '@value-hub/valuation-shared';
import { StorageService } from '../../common/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import { imageBlock, toJpegBase64 } from '../ai/images.js';
import { ComparisonService } from '../comparison/comparison.service.js';

const MAX_PHOTOS = 8;
const EMBEDDABLE = ['image/jpeg', 'image/png', 'image/webp'];

// Select questions an inspector answers on site, with the answers allowed, so a photograph can suggest one.
const PHOTO_QUESTIONS = OBSERVATION_SECTIONS.flatMap((s) => s.fields).filter((f) => f.type === 'select' && f.options?.length);

// Where the AI helps the valuer decide. Every answer is a suggestion: the person accepts or ignores it,
// and nothing here is saved on their behalf.
@Injectable()
export class AiAssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly comparison: ComparisonService,
  ) {}

  status() {
    return { enabled: this.ai.enabled() };
  }

  // For each difference between the documents and the site: what it probably means, and a note the valuer could record.
  async explainDifferences(firmId: string, actorId: string, assignmentId: string) {
    const data = await this.comparison.get(firmId, actorId, assignmentId);
    const rows = data.rows.filter((r) => r.status === 'mismatch' || r.status === 'verify');
    if (rows.length === 0) return { rows: [] };
    const keys = rows.map((r) => r.key);
    const result = await this.ai.json<{ rows: { key: string; explanation: string; suggested_note: string }[] }>({
      system:
        'You help an Indian property valuer understand differences between what the documents say and what the inspector saw. For each difference say, in one or two plain sentences, the most likely reasons and what the valuer should check. Then write a short note (one or two sentences, first person plural) the valuer could record in the report if they decide to accept the difference. Use only the values given. Never decide for the valuer, and never say a difference is acceptable unless it is within the stated tolerance.',
      content: [
        {
          type: 'text',
          text: `Differences found:\n${JSON.stringify(rows.map((r) => ({ key: r.key, label: r.label, document: r.document, site: r.site, difference: r.delta, tolerance: r.tolerance, hint: r.hint })), null, 1)}`,
        },
      ],
      schema: {
        type: 'object',
        properties: { rows: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: keys }, explanation: { type: 'string' }, suggested_note: { type: 'string' } }, required: ['key', 'explanation', 'suggested_note'], additionalProperties: false } } },
        required: ['rows'],
        additionalProperties: false,
      },
    });
    return { rows: result.rows.filter((r) => keys.includes(r.key) && r.explanation.trim()).map((r) => ({ key: r.key, explanation: r.explanation.trim(), suggestedNote: r.suggested_note.trim() })) };
  }

  // The valuer's assumptions and special conditions, drafted from what the case already holds.
  async draftAssumptions(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { purpose: true, borrowerName: true, property: { select: { propertyClass: true, addressLine: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [fields, differences, visit] = await Promise.all([
      this.prisma.extractedField.findMany({ where: { firmId, state: { in: ['VERIFIED', 'CORRECTED'] }, document: { assignmentId } }, select: { fieldKey: true, extractedValue: true, verifiedValue: true }, take: 80 }),
      this.prisma.discrepancy.findMany({ where: { firmId, assignmentId, status: { in: ['RESOLVED', 'DISCLOSED'] } }, select: { fieldKey: true, description: true, resolutionNote: true, status: true }, take: 20 }),
      this.prisma.inspection.findFirst({ where: { assignmentId, firmId }, orderBy: { visitedAt: 'desc' }, select: { observations: true } }),
    ]);
    const result = await this.ai.json<{ assumptions: string; needs_input: string[] }>({
      system:
        "You help an Indian property valuer write the 'Assumptions and special conditions' paragraph of a valuation report. Write two to five short sentences in plain professional English. Include only assumptions that follow from the facts given (title taken as clear from the documents seen, area as measured, differences the valuer disclosed, vacant possession if noted). Do not invent facts. If something important is missing, list it in needs_input.",
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            purpose: assignment.purpose,
            borrower: assignment.borrowerName,
            property: { class: assignment.property.propertyClass, address: assignment.property.addressLine },
            verified_facts: Object.fromEntries(fields.map((f) => [f.fieldKey, f.verifiedValue ?? f.extractedValue])),
            differences_the_valuer_decided: differences,
            site_observations: visit?.observations ?? {},
          }, null, 1),
        },
      ],
      schema: { type: 'object', properties: { assumptions: { type: 'string' }, needs_input: { type: 'array', items: { type: 'string' } } }, required: ['assumptions', 'needs_input'], additionalProperties: false },
    });
    return { assumptions: result.assumptions.trim(), needsInput: result.needs_input };
  }

  // What the site photographs show, as answers to the inspector's own questions.
  async observeFromPhotos(firmId: string, inspectionId: string) {
    const visit = await this.prisma.inspection.findFirst({ where: { id: inspectionId, firmId }, select: { id: true } });
    if (!visit) throw new NotFoundException('Inspection not found');
    const rows = await this.prisma.inspectionPhoto.findMany({ where: { inspectionId, mimeType: { in: EMBEDDABLE } }, orderBy: { id: 'asc' }, take: MAX_PHOTOS });
    const content: Parameters<AiService['json']>[0]['content'] = [];
    let used = 0;
    for (const photo of rows) {
      try {
        const base64 = await toJpegBase64(await this.storage.read(photo.storageKey));
        used += 1;
        content.push({ type: 'text', text: `Photo ${used}${photo.category ? ` (${photo.category})` : ''}${photo.caption ? `: ${photo.caption}` : ''}` }, imageBlock(base64));
      } catch {
        // A photo whose file is gone is left out.
      }
    }
    if (used === 0) return { suggestions: [], photos: 0 };
    content.unshift({ type: 'text', text: `These ${used} photographs were taken at a property inspection. Answer only the questions the photographs clearly settle, using exactly one of the allowed answers. Leave out anything you cannot see.\n\n${PHOTO_QUESTIONS.map((q) => `- ${q.key} (${q.label}): ${q.options?.join(' | ')}`).join('\n')}` });
    const result = await this.ai.json<{ observations: { key: string; value: string; evidence: string }[] }>({
      system: 'You assist a property inspector by reading site photographs. Report only what is visible. Do not guess.',
      content,
      schema: {
        type: 'object',
        properties: { observations: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: PHOTO_QUESTIONS.map((q) => q.key) }, value: { type: 'string' }, evidence: { type: 'string' } }, required: ['key', 'value', 'evidence'], additionalProperties: false } } },
        required: ['observations'],
        additionalProperties: false,
      },
    });
    const suggestions = result.observations
      .map((o) => ({ ...o, question: PHOTO_QUESTIONS.find((q) => q.key === o.key) }))
      .filter((o) => o.question?.options?.includes(o.value))
      .map((o) => ({ key: o.key, label: o.question?.label ?? o.key, value: o.value, evidence: o.evidence }));
    return { suggestions, photos: used };
  }
}
