import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const LIMIT = 80;

// Everything that was recorded about one assignment and the records that belong to it, newest first.
@Controller('assignments/:assignmentId/timeline')
export class TimelineController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async timeline(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    const firmId = user.firmId;
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { id: true, propertyId: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const [documents, inspections, valuations, reports, discrepancies, queries, submissions, invoices] = await Promise.all([
      this.prisma.document.findMany({ where: { firmId, propertyId: assignment.propertyId }, select: { id: true }, take: 200 }),
      this.prisma.inspection.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 50 }),
      this.prisma.valuationVersion.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 50 }),
      this.prisma.reportVersion.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 50 }),
      this.prisma.discrepancy.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 200 }),
      this.prisma.bankQuery.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 100 }),
      this.prisma.submission.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 50 }),
      this.prisma.invoice.findMany({ where: { firmId, assignmentId }, select: { id: true }, take: 50 }),
    ]);
    const ids = [assignmentId, ...[documents, inspections, valuations, reports, discrepancies, queries, submissions, invoices].flat().map((r) => r.id)];

    const rows = await this.prisma.auditEvent.findMany({ where: { firmId, entityId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: LIMIT });
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds }, firmId }, select: { id: true, fullName: true } });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return { items: rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, at: r.createdAt, by: r.actorId ? (names.get(r.actorId) ?? null) : null })) };
  }
}
