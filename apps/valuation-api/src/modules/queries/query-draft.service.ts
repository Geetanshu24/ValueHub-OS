import { Injectable, NotFoundException } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface QueryDraft {
  reply: string;
  // Things the answer needs that are not in the records: the valuer must supply or confirm them.
  needsInput: string[];
}

@Injectable()
export class QueryDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  // Drafts the reply to a bank's query from the assignment's records. The valuer edits and sends it.
  async draft(firmId: string, queryId: string): Promise<QueryDraft> {
    const query = await this.prisma.bankQuery.findFirst({ where: { id: queryId, firmId }, select: { question: true, kind: true, assignmentId: true } });
    if (!query) throw new NotFoundException('Query not found');
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: query.assignmentId, firmId },
      select: { code: true, purpose: true, valuationDate: true, bank: { select: { name: true } }, branch: { select: { name: true } }, property: { select: { addressLine: true, propertyClass: true, district: true } }, bankReportForms: { select: { format: true, values: true } } },
    });
    const valuation = await this.prisma.valuationVersion.findFirst({ where: { assignmentId: query.assignmentId, firmId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true, method: true, areaBasis: true, adoptedAreaSqm: true, adoptedAreaSource: true, assumptions: true, totalValue: true } });
    const documents = await this.prisma.document.findMany({
      where: { firmId, assignment: { id: query.assignmentId } },
      take: 30,
      select: { fileName: true, type: true, fields: { select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true }, take: 60 } },
    });
    const facts = documents.map((d) => ({ document: `${d.type}: ${d.fileName}`, facts: Object.fromEntries(d.fields.filter((f) => f.state !== 'UNKNOWN').map((f) => [f.fieldKey, f.verifiedValue ?? f.extractedValue])) }));

    const result = await this.ai.json<{ reply: string; needs_input: string[] }>({
      system:
        'You help an Indian property valuer answer a query from a bank about a valuation report. Write the reply in a polite, professional tone, in first person plural ("we"), addressed to the bank officer. Answer only from the records supplied. Where the records do not contain what the query asks for, do not guess: say nothing about that part and list it in needs_input so the valuer can supply it. Do not promise changes to the value. Keep it short and specific.',
      content: [{ type: 'text', text: `Query from the bank (${query.kind === 'REVISION_REQUEST' ? 'revision request' : 'query'}):\n${query.question}\n\nAssignment:\n${JSON.stringify({ ...assignment, bankReportForms: undefined, bank: assignment?.bank.name, branch: assignment?.branch?.name }, null, 1)}\n\nLatest valuation:\n${JSON.stringify(valuation, null, 1)}\n\nAnswers in the report form:\n${JSON.stringify(assignment?.bankReportForms.map((f) => ({ format: f.format, answers: f.values })), null, 1).slice(0, 14000)}\n\nFacts read from the documents:\n${JSON.stringify(facts, null, 1).slice(0, 8000)}` }],
      schema: { type: 'object', properties: { reply: { type: 'string' }, needs_input: { type: 'array', items: { type: 'string' } } }, required: ['reply', 'needs_input'], additionalProperties: false },
    });
    return { reply: result.reply.trim(), needsInput: result.needs_input };
  }
}
