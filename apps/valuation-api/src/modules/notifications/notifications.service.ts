import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AssignedNotice {
  firmId: string;
  userId: string;
  assignmentId: string;
  kind: 'ASSIGNED' | 'REASSIGNED';
  code: string;
  bankName: string;
  purpose: string;
  assignedByName: string;
  // "drafter" or "site inspector" when the person is joining as that, not as the valuer.
  asRole?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Called inside the transaction that gives someone a case, so the pop-up exists exactly when the assignment does.
  notifyAssigned(tx: Prisma.TransactionClient, notice: AssignedNotice) {
    const verb = `${notice.kind === 'REASSIGNED' ? 'reassigned to you' : 'assigned to you'}${notice.asRole ? ` as ${notice.asRole}` : ''}`;
    return tx.notification.create({
      data: {
        firmId: notice.firmId,
        userId: notice.userId,
        assignmentId: notice.assignmentId,
        kind: notice.kind,
        title: `New case ${verb}`,
        body: `${notice.code} · ${notice.bankName} · ${notice.purpose}. Assigned by ${notice.assignedByName}.`,
      },
    });
  }

  // A plain message to one person (e.g. "the draft is ready to check").
  notify(tx: Prisma.TransactionClient, data: { firmId: string; userId: string; assignmentId: string; kind: string; title: string; body: string }) {
    return tx.notification.create({ data });
  }

  // Unread notices for the signed-in user, with enough of the case to show in the pop-up.
  async unread(firmId: string, userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { firmId, userId, seenAt: null },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const ids = [...new Set(rows.flatMap((r) => (r.assignmentId ? [r.assignmentId] : [])))];
    const cases = await this.prisma.assignment.findMany({
      where: { id: { in: ids }, firmId },
      select: { id: true, code: true, purpose: true, dueDate: true, priority: true, intakeSource: true, bank: { select: { name: true } }, property: { select: { addressLine: true } } },
    });
    const byId = new Map(cases.map((c) => [c.id, c]));
    return rows.map((r) => ({ ...r, assignment: r.assignmentId ? (byId.get(r.assignmentId) ?? null) : null }));
  }

  // Seeing the pop-up is the valuer's acknowledgement of the case; the admin can see when it happened.
  async markSeen(firmId: string, userId: string, id: string) {
    const notice = await this.prisma.notification.findFirst({ where: { id, firmId, userId } });
    if (!notice) throw new NotFoundException('Notification not found');
    if (notice.seenAt) return { seen: true };
    await this.prisma.$transaction(async (tx) => {
      await tx.notification.update({ where: { id }, data: { seenAt: new Date() } });
      if (notice.assignmentId) {
        const { count } = await tx.assignment.updateMany({
          where: { id: notice.assignmentId, firmId, assignedValuerId: userId, acknowledgedAt: null },
          data: { acknowledgedAt: new Date() },
        });
        if (count === 1) {
          await this.audit.record({ firmId, actorId: userId, entityType: 'Assignment', entityId: notice.assignmentId, action: 'assignment.acknowledged' }, tx);
        }
      }
    });
    return { seen: true };
  }
}
