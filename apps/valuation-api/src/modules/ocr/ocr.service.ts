import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import { toJpegBase64 } from '../ai/images.js';
import { aiSuggest } from './ai-extract.js';
import { suggestFields, type Suggestion } from './suggest.js';
import { extractText, renderPdfPages } from './text-extract.js';

const PAGE_BREAK = '\f';
const MAX_VISION_PAGES = 10;
// Records kept in Hindi: the AI reads the page pictures rather than the OCR text.
const HINDI_TYPES: DocumentType[] = ['REVENUE_RECORD', 'PATWARI_REPORT', 'MAGISTRATE_CERTIFICATE'];
const mostlyDevanagari = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters > 50 && (text.match(/[\u0900-\u097F]/g)?.length ?? 0) / letters > 0.3;
};

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  // The AI read is an addition: with no key set, or if the call fails, the pattern suggestions stand alone.
  // Hindi records and photographed screens are read from the pictures, as OCR reads them badly.
  private async readWithAi(pages: string[], document: { type: string; mimeType: string; bytes: Buffer }): Promise<Suggestion[]> {
    if (!this.ai.enabled()) return [];
    try {
      const type = document.type as DocumentType;
      let images: string[] | undefined;
      if (document.mimeType.startsWith('image/')) images = [await toJpegBase64(document.bytes)];
      else if (document.mimeType === 'application/pdf' && (HINDI_TYPES.includes(type) || mostlyDevanagari(pages.join('')))) {
        images = await Promise.all((await renderPdfPages(document.bytes, MAX_VISION_PAGES)).map((png) => toJpegBase64(png)));
      }
      return await aiSuggest(pages, DOCUMENT_TYPE_LABELS[type] ?? 'Document', this.ai, images);
    } catch (caught) {
      this.logger.warn(`AI read failed: ${(caught as Error).message.slice(0, 300)}`);
      return [];
    }
  }

  // Reads a document, stores its text for search, and records the facts it
  // seems to contain as UNVERIFIED suggestions. Facts a person has already
  // reviewed are never touched; only earlier unreviewed suggestions are replaced.
  async run(firmId: string, actorId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, firmId }, select: { id: true, storageKey: true, mimeType: true, pageCount: true, type: true } });
    if (!document) throw new NotFoundException('Document not found');

    let status: 'DONE' | 'NO_TEXT' | 'FAILED';
    let error: string | undefined;
    let pages: string[] = [];
    let bytes: Buffer = Buffer.alloc(0);
    try {
      bytes = await this.storage.read(document.storageKey);
      const extracted = await extractText(bytes, document.mimeType);
      pages = extracted.pages;
      status = extracted.note ? 'NO_TEXT' : 'DONE';
      error = extracted.note;
    } catch (caught) {
      status = 'FAILED';
      error = (caught as Error).message.slice(0, 500);
      this.logger.warn(`OCR failed for ${documentId}: ${error}`);
    }

    let suggestions: Suggestion[] = [];
    if (status === 'DONE') suggestions = suggestFields(pages);
    // A picture with no readable text can still be read by the AI.
    if (status === 'DONE' || (status === 'NO_TEXT' && this.ai.enabled())) {
      suggestions.push(...(await this.readWithAi(pages, { type: document.type, mimeType: document.mimeType, bytes })));
      suggestions = suggestions.filter((s) => !document.pageCount || s.pageNumber <= document.pageCount);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { ocrStatus: status, ocrText: pages.length ? pages.join(PAGE_BREAK) : null, ocrError: error ?? null, ocrAt: new Date() },
      });
      await tx.extractedField.deleteMany({ where: { documentId, firmId, source: 'OCR', state: 'UNVERIFIED' } });
      if (suggestions.length > 0) {
        await tx.extractedField.createMany({
          data: suggestions.map((s) => ({ firmId, documentId, fieldKey: s.fieldKey, extractedValue: s.value, pageNumber: s.pageNumber, confidence: s.confidence, source: 'OCR' as const })),
        });
      }
      await this.audit.record({ firmId, actorId, entityType: 'Document', entityId: documentId, action: 'document.ocr', metadata: { status, suggestions: suggestions.length } }, tx);
      return { status, error: error ?? null, pages: pages.length, suggested: suggestions.length };
    });
  }
}
