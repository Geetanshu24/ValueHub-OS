import { BadRequestException, Injectable, Logger, NotFoundException, StreamableFile } from '@nestjs/common';
import { AREA_FIELD_KEYS, UPLOAD_LIMITS, type Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { requireFile, safeFileName } from '../../common/storage/file-validation.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OcrService } from '../ocr/ocr.service.js';
import type {
  AddExtractedFieldDto,
  ListDocumentsQuery,
  ReviewFieldDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './documents.dto.js';

// storageKey stays server-side; clients download through the authenticated
// endpoint instead.
const documentSelect = {
  id: true,
  type: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  sha256: true,
  uploadedAt: true,
  propertyId: true,
  assignmentId: true,
  source: true,
  ocrStatus: true,
  ocrError: true,
  ocrAt: true,
} satisfies Prisma.DocumentSelect;

const fieldSelect = {
  id: true,
  documentId: true,
  fieldKey: true,
  extractedValue: true,
  pageNumber: true,
  confidence: true,
  source: true,
  state: true,
  verifiedValue: true,
  useInReport: true,
  reviewedAt: true,
} satisfies Prisma.ExtractedFieldSelect;

const MAX_FIELDS_PER_DOCUMENT = 200;

function isPositiveNumber(value: string): boolean {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly ocr: OcrService,
  ) {}

  // Reading a scan can take a minute, so it runs after the upload has answered.
  // A failure is recorded on the document by the OCR service; it never fails the upload.
  private readInBackground(firmId: string, actorId: string, documentId: string) {
    if (process.env.OCR_ON_UPLOAD === 'false' || process.env.NODE_ENV === 'test') return;
    void this.ocr.run(firmId, actorId, documentId).catch((error: unknown) => this.logger.warn(`Automatic read failed for ${documentId}: ${(error as Error).message}`));
  }

  async upload(
    firmId: string,
    actorId: string,
    propertyId: string,
    dto: UploadDocumentDto,
    upload: Express.Multer.File | undefined,
  ) {
    const { file, mimeType } = requireFile(upload, ['application/pdf', 'image/jpeg', 'image/png']);
    if (file.size > UPLOAD_LIMITS.documentBytes) throw new BadRequestException('File is too large');

    const property = await this.prisma.property.findFirst({ where: { id: propertyId, firmId }, select: { id: true } });
    if (!property) throw new NotFoundException('Property not found');
    if (dto.assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: dto.assignmentId, firmId, propertyId },
        select: { id: true },
      });
      if (!assignment) throw new BadRequestException('Assignment does not belong to this property');
    }

    const stored = await this.storage.save(firmId, file.buffer);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            firmId,
            propertyId,
            assignmentId: dto.assignmentId,
            type: dto.type,
            source: dto.source,
            fileName: safeFileName(file.originalname),
            mimeType,
            sizeBytes: stored.sizeBytes,
            pageCount: dto.pageCount,
            storageKey: stored.storageKey,
            sha256: stored.sha256,
            uploadedById: actorId,
          },
          select: documentSelect,
        });
        await this.audit.record(
          {
            firmId,
            actorId,
            entityType: 'Document',
            entityId: document.id,
            action: 'document.uploaded',
            metadata: { sha256: stored.sha256, type: dto.type },
          },
          tx,
        );
        return document;
      });
      this.readInBackground(firmId, actorId, created.id);
      return created;
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  async list(firmId: string, query: ListDocumentsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.DocumentWhereInput = {
      firmId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.assignmentId && { assignmentId: query.assignmentId }),
      ...(query.type && { type: query.type }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy: { uploadedAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.document.count({ where }),
    ]);

    // How many facts on each file are still waiting for a person.
    const grouped = await this.prisma.extractedField.groupBy({
      by: ['documentId', 'state'],
      where: { firmId, documentId: { in: items.map((item) => item.id) } },
      _count: { _all: true },
    });
    const counts = new Map<string, { total: number; unverified: number }>();
    for (const row of grouped) {
      const entry = counts.get(row.documentId) ?? { total: 0, unverified: 0 };
      entry.total += row._count._all;
      if (row.state === 'UNVERIFIED') entry.unverified += row._count._all;
      counts.set(row.documentId, entry);
    }
    return {
      items: items.map((item) => ({ ...item, facts: counts.get(item.id) ?? { total: 0, unverified: 0 } })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // One document with the text read from it, for the preview and review panel.
  async get(firmId: string, id: string) {
    const document = await this.prisma.document.findFirst({ where: { id, firmId }, select: { ...documentSelect, ocrText: true } });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async update(firmId: string, actorId: string, id: string, dto: UpdateDocumentDto) {
    const current = await this.prisma.document.findFirst({ where: { id, firmId }, select: { type: true } });
    if (!current) throw new NotFoundException('Document not found');
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.document.update({ where: { id }, data: { type: dto.type }, select: documentSelect });
      await this.audit.record({ firmId, actorId, entityType: 'Document', entityId: id, action: 'document.reclassified', metadata: { from: current.type, to: dto.type } }, tx);
      return document;
    });
  }

  async download(firmId: string, actorId: string, id: string): Promise<StreamableFile> {
    const document = await this.prisma.document.findFirst({
      where: { id, firmId },
      select: { storageKey: true, fileName: true, mimeType: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    await this.audit.record({ firmId, actorId, entityType: 'Document', entityId: id, action: 'document.downloaded' });
    return new StreamableFile(await this.storage.open(document.storageKey), {
      type: document.mimeType,
      disposition: `attachment; filename="${document.fileName}"`,
    });
  }

  async listFields(firmId: string, documentId: string) {
    await this.requireDocument(firmId, documentId);
    return this.prisma.extractedField.findMany({
      where: { documentId, firmId },
      select: fieldSelect,
      orderBy: [{ pageNumber: 'asc' }, { fieldKey: 'asc' }],
      take: MAX_FIELDS_PER_DOCUMENT,
    });
  }

  // Records a suggested fact (typed in, or later produced by OCR). It always
  // starts UNVERIFIED.
  async addField(firmId: string, actorId: string, documentId: string, dto: AddExtractedFieldDto) {
    const document = await this.requireDocument(firmId, documentId);
    if (document.pageCount && dto.pageNumber > document.pageCount) {
      throw new BadRequestException(`pageNumber exceeds the document's ${document.pageCount} pages`);
    }
    this.assertValueShape(dto.fieldKey, dto.extractedValue);

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.extractedField.count({ where: { documentId } });
      if (count >= MAX_FIELDS_PER_DOCUMENT) throw new BadRequestException('Too many fields on this document');

      const field = await tx.extractedField.create({
        data: { ...dto, firmId, documentId },
        select: fieldSelect,
      });
      await this.audit.record(
        { firmId, actorId, entityType: 'ExtractedField', entityId: field.id, action: 'field.suggested' },
        tx,
      );
      return field;
    });
  }

  // Saves what the drafter read from this document for one fact. The newest entry for that fact is
  // updated (so a cell never piles up copies); an empty value marks it unknown so it drops out of the report.
  async setFieldValue(firmId: string, actorId: string, documentId: string, fieldKey: string, rawValue: string) {
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(fieldKey)) throw new BadRequestException('fieldKey must be snake_case');
    await this.requireDocument(firmId, documentId);
    const value = rawValue.trim();
    if (value) this.assertValueShape(fieldKey, value);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.extractedField.findFirst({
        where: { documentId, firmId, fieldKey },
        orderBy: { id: 'desc' },
        select: { id: true, extractedValue: true, state: true, verifiedValue: true },
      });
      if (!existing) {
        if (!value) return null;
        const created = await tx.extractedField.create({
          data: { firmId, documentId, fieldKey, extractedValue: value, pageNumber: 1, source: 'MANUAL' },
          select: fieldSelect,
        });
        await this.audit.record({ firmId, actorId, entityType: 'ExtractedField', entityId: created.id, action: 'field.entered' }, tx);
        return created;
      }
      const current = (existing.state === 'CORRECTED' ? existing.verifiedValue ?? existing.extractedValue : existing.extractedValue).trim();
      if (value === current && existing.state !== 'UNKNOWN') return tx.extractedField.findUniqueOrThrow({ where: { id: existing.id }, select: fieldSelect });
      const updated = await tx.extractedField.update({
        where: { id: existing.id },
        data: value
          ? { extractedValue: value, state: 'UNVERIFIED', verifiedValue: null, reviewedById: null, reviewedAt: null, source: 'MANUAL' }
          : { state: 'UNKNOWN', reviewedById: actorId, reviewedAt: new Date() },
        select: fieldSelect,
      });
      await this.audit.record({ firmId, actorId, entityType: 'ExtractedField', entityId: updated.id, action: value ? 'field.entered' : 'field.cleared' }, tx);
      return updated;
    });
  }

  // The drafter picks which document's value the report uses for a fact. One choice per fact across the
  // property's documents; the others stay as they are, and review states are left alone.
  async useFieldInReport(firmId: string, actorId: string, documentId: string, fieldKey: string) {
    const document = await this.requireDocument(firmId, documentId);
    return this.prisma.$transaction(async (tx) => {
      const chosen = await tx.extractedField.findFirst({ where: { documentId, firmId, fieldKey, state: { not: 'UNKNOWN' } }, orderBy: { id: 'desc' }, select: { id: true } });
      if (!chosen) throw new BadRequestException('This document has no value for that fact yet');
      await tx.extractedField.updateMany({ where: { firmId, fieldKey, useInReport: true, document: { propertyId: document.propertyId } }, data: { useInReport: false } });
      const updated = await tx.extractedField.update({ where: { id: chosen.id }, data: { useInReport: true }, select: fieldSelect });
      await this.audit.record({ firmId, actorId, entityType: 'ExtractedField', entityId: chosen.id, action: 'field.chosen_for_report', metadata: { fieldKey } }, tx);
      return updated;
    });
  }

  async reviewField(firmId: string, actorId: string, fieldId: string, dto: ReviewFieldDto) {
    const field = await this.prisma.extractedField.findFirst({
      where: { id: fieldId, firmId },
      select: { id: true, fieldKey: true, state: true },
    });
    if (!field) throw new NotFoundException('Field not found');

    if (dto.outcome === 'CORRECTED') {
      if (!dto.verifiedValue) throw new BadRequestException('verifiedValue is required when correcting a field');
      this.assertValueShape(field.fieldKey, dto.verifiedValue);
    } else if (dto.verifiedValue) {
      throw new BadRequestException('verifiedValue is only allowed with outcome CORRECTED');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.extractedField.update({
        where: { id: fieldId },
        data: {
          state: dto.outcome,
          verifiedValue: dto.outcome === 'CORRECTED' ? dto.verifiedValue : null,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
        select: fieldSelect,
      });
      await this.audit.record(
        {
          firmId,
          actorId,
          entityType: 'ExtractedField',
          entityId: fieldId,
          action: 'field.reviewed',
          metadata: { from: field.state, to: dto.outcome },
        },
        tx,
      );
      return updated;
    });
  }

  private async requireDocument(firmId: string, id: string) {
    const document = await this.prisma.document.findFirst({ where: { id, firmId }, select: { id: true, pageCount: true, propertyId: true } });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private assertValueShape(fieldKey: string, value: string) {
    if ((AREA_FIELD_KEYS as readonly string[]).includes(fieldKey) && !isPositiveNumber(value)) {
      throw new BadRequestException(`${fieldKey} must be a positive number (sq. m)`);
    }
  }
}
