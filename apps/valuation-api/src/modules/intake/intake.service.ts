import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UPLOAD_LIMITS, type Paginated } from '@value-hub/valuation-shared';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { requireFile } from '../../common/storage/file-validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { extractText } from '../ocr/text-extract.js';
import { parseDeed, parseInstruction } from './intake-parse.js';
import type { PreviousWorkQuery } from './intake.dto.js';

const MAX_FILES = 10;

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Reads the files an instruction arrived in and suggests the assignment
  // details. Nothing is stored: the files are uploaded again, against the
  // assignment, once a person has confirmed the details.
  async extract(firmId: string, uploads: Express.Multer.File[]) {
    const { files, text } = await this.readFiles(uploads);
    const banks = await this.prisma.bank.findMany({ where: { firmId }, select: { id: true, name: true } });
    return { files, fields: text ? parseInstruction(text, banks) : {} };
  }

  // Reads a sale deed for the buyer, their father or husband, the property
  // type, the land area and the address.
  async extractDeed(uploads: Express.Multer.File[]) {
    const { files, text } = await this.readFiles(uploads);
    return { files, fields: text ? parseDeed(text) : {} };
  }

  private async readFiles(uploads: Express.Multer.File[]) {
    if (uploads.length === 0) throw new BadRequestException('Add at least one file');
    if (uploads.length > MAX_FILES) throw new BadRequestException(`At most ${MAX_FILES} files can be read at once`);

    const files: { name: string; status: 'READ' | 'NO_TEXT' | 'FAILED'; note?: string }[] = [];
    const texts: string[] = [];
    for (const upload of uploads) {
      const { file, mimeType } = requireFile(upload, ['application/pdf', 'image/jpeg', 'image/png']);
      if (file.size > UPLOAD_LIMITS.documentBytes) throw new BadRequestException(`${file.originalname} is too large`);
      try {
        const extracted = await extractText(file.buffer, mimeType);
        if (extracted.note) files.push({ name: file.originalname, status: 'NO_TEXT', note: extracted.note });
        else { files.push({ name: file.originalname, status: 'READ' }); texts.push(extracted.pages.join('\n')); }
      } catch (caught) {
        this.logger.warn(`Intake read failed for ${file.originalname}: ${(caught as Error).message}`);
        files.push({ name: file.originalname, status: 'FAILED', note: (caught as Error).message.slice(0, 200) });
      }
    }

    return { files, text: texts.join('\n') };
  }

  // Earlier reports on matching properties, newest first, one row per assignment.
  async previousWork(firmId: string, query: PreviousWorkQuery): Promise<Paginated<unknown>> {
    const q = query.q?.trim();
    const contains = (value: string) => ({ contains: value.trim(), mode: 'insensitive' as const });
    const since = query.years ? new Date(new Date().setFullYear(new Date().getFullYear() - query.years)) : undefined;

    const where: Prisma.ReportVersionWhereInput = {
      firmId,
      status: { in: ['APPROVED', 'ISSUED'] },
      ...(since && { createdAt: { gte: since } }),
      assignment: {
        ...(query.bankId && { bankId: query.bankId }),
        property: {
          ...(query.propertyClass && { propertyClass: query.propertyClass }),
          ...(query.state && { state: contains(query.state) }),
          ...(query.district && { district: contains(query.district) }),
          ...(query.locality && { locality: contains(query.locality) }),
        },
        ...(q && {
          OR: [
            { code: contains(q) },
            { property: { code: contains(q) } },
            { property: { addressLine: contains(q) } },
            { property: { locality: contains(q) } },
            { property: { district: contains(q) } },
          ],
        }),
      },
    };

    // One row per assignment: its latest approved or issued report.
    const latest = await this.prisma.reportVersion.findMany({
      where,
      distinct: ['assignmentId'],
      orderBy: [{ assignmentId: 'asc' }, { versionNumber: 'desc' }],
      select: { id: true },
    });
    const ids = latest.map((row) => row.id);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reportVersion.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        select: {
          id: true,
          versionNumber: true,
          status: true,
          createdAt: true,
          issuedAt: true,
          valuationVersion: { select: { totalValue: true } },
          assignment: {
            select: {
              id: true,
              code: true,
              purpose: true,
              bank: { select: { id: true, name: true } },
              property: { select: { id: true, code: true, addressLine: true, propertyClass: true, locality: true, district: true, state: true } },
            },
          },
        },
      }),
      this.prisma.reportVersion.count({ where: { id: { in: ids } } }),
    ]);

    return {
      items: items.map(({ valuationVersion, versionNumber, ...rest }) => ({
        ...rest,
        reportNumber: `${rest.assignment.code}-R${versionNumber}`,
        totalValue: valuationVersion.totalValue,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
