import { BadRequestException, Injectable } from '@nestjs/common';
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@value-hub/valuation-shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const OPEN_STATUSES = ASSIGNMENT_STATUSES.filter((s) => !['SUBMITTED', 'CLOSED', 'CANCELLED'].includes(s));
const DAY = 24 * 3600 * 1000;
const startOfToday = () => new Date(new Date().toDateString());

export const GROUPINGS = ['bank', 'branch', 'valuer', 'propertyClass'] as const;
export type Grouping = (typeof GROUPINGS)[number];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser) {
    const { firmId } = user;
    const today = startOfToday();
    const tomorrow = new Date(today.getTime() + DAY);
    const weekAhead = new Date(today.getTime() + 7 * DAY);
    const weekAgo = new Date(today.getTime() - 7 * DAY);

    const inspectionScope = { firmId, ...(user.role === 'INSPECTOR' && { inspectorId: user.userId }) };
    const inspections = Promise.all([
      this.prisma.inspection.count({ where: { ...inspectionScope, status: 'SCHEDULED', visitedAt: { gte: today, lt: weekAhead } } }),
      this.prisma.inspection.count({ where: { ...inspectionScope, status: 'IN_PROGRESS' } }),
      this.prisma.inspection.count({ where: { ...inspectionScope, status: 'SUBMITTED' } }),
    ]).then(([upcomingWeek, inProgress, awaitingFieldReview]) => ({ upcomingWeek, inProgress, awaitingFieldReview }));

    // Inspectors see their own field work only.
    if (user.role === 'INSPECTOR') return { inspections: await inspections };

    const [grouped, newThisWeek, dueToday, overdue, insp, awaitingValuation, reportStates, queriesOpen, queriesDueSoon, receivables] = await Promise.all([
      this.prisma.assignment.groupBy({ by: ['status'], where: { firmId }, _count: { _all: true } }),
      this.prisma.assignment.count({ where: { firmId, receivedAt: { gte: weekAgo } } }),
      this.prisma.assignment.count({ where: { firmId, dueDate: { gte: today, lt: tomorrow }, status: { in: OPEN_STATUSES } } }),
      this.prisma.assignment.count({ where: { firmId, dueDate: { lt: today }, status: { in: OPEN_STATUSES } } }),
      inspections,
      this.prisma.assignment.count({ where: { firmId, status: 'VALUATION', valuations: { none: { status: { in: ['IN_REVIEW', 'APPROVED'] } } } } }),
      this.prisma.reportVersion.groupBy({ by: ['status'], where: { firmId, status: { in: ['DRAFT', 'IN_REVIEW', 'APPROVED'] } }, _count: { _all: true } }),
      this.prisma.bankQuery.count({ where: { firmId, status: 'OPEN' } }),
      this.prisma.bankQuery.count({ where: { firmId, status: 'OPEN', dueAt: { lt: new Date(Date.now() + 2 * DAY) } } }),
      this.receivables(firmId),
    ]);

    const byStatus = Object.fromEntries(ASSIGNMENT_STATUSES.map((s) => [s, 0])) as Record<AssignmentStatus, number>;
    for (const row of grouped) byStatus[row.status] = row._count._all;
    const reportCount = (status: string) => reportStates.find((r) => r.status === status)?._count._all ?? 0;

    return {
      assignments: { byStatus, open: OPEN_STATUSES.reduce((t, s) => t + byStatus[s], 0), newThisWeek, dueToday, overdue },
      inspections: insp,
      reports: {
        awaitingValuation,
        awaitingQc: reportCount('DRAFT') + reportCount('IN_REVIEW'),
        awaitingSignature: reportCount('APPROVED'),
      },
      queries: { open: queriesOpen, dueWithinTwoDays: queriesDueSoon },
      receivables,
    };
  }

  // The work waiting on this person, earliest due first. A valuer sees their
  // own assignments, a reviewer what is in or near review, an admin everything
  // open, and an inspector their own pending site visits.
  async workQueue(user: AuthUser) {
    const { firmId } = user;
    const pick = {
      id: true, code: true, status: true, dueDate: true, priority: true, borrowerName: true,
      bank: { select: { name: true } },
      property: { select: { addressLine: true } },
      assignedValuer: { select: { fullName: true } },
    } as const;
    if (user.role === 'INSPECTOR') {
      const visits = await this.prisma.inspection.findMany({
        where: { firmId, inspectorId: user.userId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        select: { visitedAt: true, status: true, assignment: { select: pick } },
        orderBy: { visitedAt: 'asc' },
        take: 50,
      });
      return visits.map((v) => ({ ...v.assignment, visitAt: v.visitedAt, visitStatus: v.status }));
    }
    const rows = await this.prisma.assignment.findMany({
      where: {
        firmId,
        status: { in: [...OPEN_STATUSES, 'SUBMITTED'] },
        ...(user.role === 'VALUER' && { assignedValuerId: user.userId }),
        ...(user.role === 'REVIEWER' && { status: { in: ['VALUATION', 'QUALITY_REVIEW', 'APPROVED'] } }),
      },
      select: pick,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return rows.map((r) => ({ ...r, visitAt: null, visitStatus: null }));
  }

  // Follow-ups computed from live data, so there is no reminder table to keep
  // in sync. Nothing here is sent anywhere; people act on it.
  async reminders(user: AuthUser) {
    if (user.role === 'INSPECTOR') return [];
    const { firmId } = user;
    const now = new Date();
    const today = startOfToday();
    const soon = new Date(today.getTime() + 3 * DAY);
    const ackCutoff = new Date(now.getTime() - 7 * DAY);

    const [assignments, queries, invoices, unacknowledged] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { firmId, status: { in: OPEN_STATUSES }, dueDate: { lte: soon }, ...(user.role === 'VALUER' && { assignedValuerId: user.userId }) },
        select: { id: true, code: true, dueDate: true, status: true },
        orderBy: { dueDate: 'asc' },
        take: 100,
      }),
      this.prisma.bankQuery.findMany({
        where: { firmId, status: 'OPEN', dueAt: { lte: new Date(now.getTime() + 2 * DAY) } },
        select: { id: true, code: true, dueAt: true, assignmentId: true },
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
      this.prisma.invoice.findMany({
        where: { firmId, status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueOn: { lt: today } },
        select: { id: true, code: true, dueOn: true, assignmentId: true, amount: true, payments: { select: { amount: true, voidedAt: true } } },
        orderBy: { dueOn: 'asc' },
        take: 100,
      }),
      this.prisma.submission.findMany({
        where: { firmId, deliveryStatus: { not: 'FAILED' }, acknowledgedAt: null, sentAt: { lt: ackCutoff } },
        select: { id: true, assignmentId: true, sentAt: true, assignment: { select: { code: true } } },
        orderBy: { sentAt: 'asc' },
        take: 100,
      }),
    ]);

    const items = [
      ...assignments.map((a) => ({
        type: 'ASSIGNMENT_DUE', assignmentId: a.id, ref: a.code, dueAt: a.dueDate, overdue: a.dueDate < today,
        message: `${a.code} is ${a.dueDate < today ? 'overdue' : 'due soon'} (${a.status.toLowerCase().replace('_', ' ')})`,
      })),
      ...queries.map((q) => ({
        type: 'QUERY_DUE', assignmentId: q.assignmentId, ref: q.code, dueAt: q.dueAt, overdue: q.dueAt < now,
        message: `Query ${q.code} needs a response ${q.dueAt < now ? '— overdue' : 'soon'}`,
      })),
      ...invoices.flatMap((i) => {
        const outstanding = Number(i.amount) - i.payments.filter((p) => !p.voidedAt).reduce((t, p) => t + Number(p.amount), 0);
        return outstanding > 0.004
          ? [{ type: 'INVOICE_OVERDUE', assignmentId: i.assignmentId, ref: i.code, dueAt: i.dueOn, overdue: true, message: `Invoice ${i.code} is overdue: ₹ ${outstanding.toLocaleString('en-IN')} outstanding` }]
          : [];
      }),
      ...unacknowledged.map((u) => ({
        type: 'ACKNOWLEDGEMENT_PENDING', assignmentId: u.assignmentId, ref: u.assignment.code, dueAt: u.sentAt, overdue: false,
        message: `${u.assignment.code}: no acknowledgement recorded since submission`,
      })),
    ];
    return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.getTime() - b.dueAt.getTime());
  }

  // Invoiced, received and overdue amounts, with ageing buckets.
  async receivables(firmId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { firmId, status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID'] } },
      select: { amount: true, dueOn: true, status: true, payments: { select: { amount: true, voidedAt: true } } },
      take: 5000,
    });
    const today = startOfToday().getTime();
    const buckets = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
    let invoiced = 0;
    let received = 0;
    for (const invoice of invoices) {
      const amount = Number(invoice.amount);
      const paid = invoice.payments.filter((p) => !p.voidedAt).reduce((t, p) => t + Number(p.amount), 0);
      invoiced += amount;
      received += paid;
      const outstanding = Math.round((amount - paid) * 100) / 100;
      if (outstanding <= 0) continue;
      const late = Math.floor((today - invoice.dueOn.getTime()) / DAY);
      if (late <= 0) buckets.current += outstanding;
      else if (late <= 30) buckets.d1to30 += outstanding;
      else if (late <= 60) buckets.d31to60 += outstanding;
      else if (late <= 90) buckets.d61to90 += outstanding;
      else buckets.d90plus += outstanding;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      invoiced: round(invoiced),
      received: round(received),
      outstanding: round(invoiced - received),
      ageing: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round(v)])) as typeof buckets,
    };
  }

  // Open work per person, for allocating the next assignment.
  async workload(firmId: string) {
    const people = await this.prisma.user.findMany({
      where: { firmId, isActive: true, role: { in: ['FIRM_ADMIN', 'VALUER', 'INSPECTOR'] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
    const today = startOfToday();
    const [open, late, visits] = await Promise.all([
      this.prisma.assignment.groupBy({ by: ['assignedValuerId'], where: { firmId, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
      this.prisma.assignment.groupBy({ by: ['assignedValuerId'], where: { firmId, status: { in: OPEN_STATUSES }, dueDate: { lt: today } }, _count: { _all: true } }),
      this.prisma.inspection.groupBy({ by: ['inspectorId'], where: { firmId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } }, _count: { _all: true } }),
    ]);
    const find = <T extends { _count: { _all: number } }>(rows: T[], key: keyof T, id: string) =>
      rows.find((r) => r[key] === id)?._count._all ?? 0;
    return people.map((p) => ({
      ...p,
      openAssignments: find(open, 'assignedValuerId', p.id),
      overdueAssignments: find(late, 'assignedValuerId', p.id),
      pendingInspections: find(visits, 'inspectorId', p.id),
    }));
  }

  // Reports submitted in a month, grouped as asked.
  async submittedByMonth(firmId: string, month: string, groupBy: Grouping) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must look like 2026-10');
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const submissions = await this.prisma.submission.findMany({
      where: { firmId, deliveryStatus: { not: 'FAILED' }, sentAt: { gte: from, lt: to } },
      select: {
        assignmentId: true,
        assignment: {
          select: {
            bank: { select: { name: true } },
            branch: { select: { name: true } },
            assignedValuer: { select: { fullName: true } },
            property: { select: { propertyClass: true } },
          },
        },
      },
      take: 5000,
    });
    // One count per assignment, however many times it was sent.
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (const s of submissions) {
      if (seen.has(s.assignmentId)) continue;
      seen.add(s.assignmentId);
      const label =
        groupBy === 'bank' ? s.assignment.bank.name
        : groupBy === 'branch' ? (s.assignment.branch?.name ?? 'No branch')
        : groupBy === 'valuer' ? s.assignment.assignedValuer.fullName
        : s.assignment.property.propertyClass;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return { month, groupBy, total: seen.size, groups: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
  }

  // Closed assignments that are missing something the archive should hold.
  async archiveGaps(firmId: string) {
    const closed = await this.prisma.assignment.findMany({
      where: { firmId, status: 'CLOSED' },
      select: {
        id: true,
        code: true,
        property: { select: { _count: { select: { documents: true } } } },
        _count: { select: { submissions: true } },
        valuations: { where: { status: 'APPROVED' }, select: { id: true }, take: 1 },
        reports: { where: { status: 'ISSUED' }, select: { id: true }, take: 1 },
        inspections: { where: { status: { in: ['SUBMITTED', 'REVIEWED'] } }, select: { id: true }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return closed
      .map((a) => ({
        id: a.id,
        code: a.code,
        missing: [
          ...(a.property._count.documents === 0 ? ['documents'] : []),
          ...(a.inspections.length === 0 ? ['submitted inspection'] : []),
          ...(a.valuations.length === 0 ? ['approved valuation'] : []),
          ...(a.reports.length === 0 ? ['issued report'] : []),
          ...(a._count.submissions === 0 ? ['submission record'] : []),
        ],
      }))
      .filter((a) => a.missing.length > 0);
  }
}
