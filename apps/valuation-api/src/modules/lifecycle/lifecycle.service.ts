import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { computeLifecycle } from './lifecycle.js';

@Injectable()
export class LifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async get(firmId: string, assignmentId: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { id: true, code: true, status: true, createdAt: true, closedAt: true, propertyId: true, assignedValuer: { select: { fullName: true } }, bank: { select: { name: true } }, branch: { select: { name: true } }, borrowerName: true, property: { select: { addressLine: true } } },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    const [documents, factCount, inspections, openMaterial, valuations, reports, submissions, invoices] = await Promise.all([
      this.prisma.document.findMany({ where: { firmId, propertyId: a.propertyId }, select: { uploadedAt: true, ocrStatus: true }, take: 200 }),
      this.prisma.extractedField.count({ where: { firmId, document: { propertyId: a.propertyId } } }),
      this.prisma.inspection.findMany({ where: { firmId, assignmentId }, orderBy: { visitedAt: 'asc' }, select: { status: true, visitedAt: true, createdAt: true, inspector: { select: { fullName: true } } }, take: 20 }),
      this.prisma.discrepancy.count({ where: { firmId, assignmentId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } } }),
      this.prisma.valuationVersion.findMany({ where: { firmId, assignmentId }, select: { createdAt: true, status: true }, take: 50 }),
      this.prisma.reportVersion.findMany({ where: { firmId, assignmentId }, select: { status: true, approvedAt: true, issuedAt: true }, take: 50 }),
      this.prisma.submission.findMany({ where: { firmId, assignmentId }, orderBy: { sentAt: 'asc' }, select: { sentAt: true, channel: true }, take: 20 }),
      this.prisma.invoice.findMany({ where: { firmId, assignmentId }, orderBy: { createdAt: 'asc' }, select: { code: true, createdAt: true }, take: 20 }),
    ]);
    const life = computeLifecycle({
      status: a.status,
      createdAt: a.createdAt,
      valuer: a.assignedValuer.fullName,
      documents,
      factCount,
      inspections: inspections.map((i) => ({ status: i.status, visitedAt: i.visitedAt, createdAt: i.createdAt, inspector: i.inspector.fullName })),
      openMaterialDiscrepancies: openMaterial,
      valuations,
      reports,
      submissions: submissions.map((s) => ({ sentAt: s.sentAt, channel: s.channel as string })),
      invoices,
      closedAt: a.closedAt,
    });
    return { ...life, counts: { documents: documents.length, openDifferences: openMaterial, inspections: inspections.length }, case: { id: a.id, code: a.code, status: a.status, bank: a.bank.name, branch: a.branch?.name ?? null, borrower: a.borrowerName, address: a.property.addressLine } };
  }
}
