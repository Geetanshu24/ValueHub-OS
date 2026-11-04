import type { AssignmentStatus } from '@value-hub/valuation-shared';
import { Prisma } from '../../generated/prisma/client.js';

interface GateContext {
  firmId: string;
  assignmentId: string;
  propertyId: string;
  to: AssignmentStatus;
}

// The blueprint's gates: what must be on record before work moves forward.
// Returns every unmet requirement so the user can fix them in one pass. Add
// new gates here rather than in the controllers.
export async function unmetGates(tx: Prisma.TransactionClient, ctx: GateContext): Promise<string[]> {
  const { firmId, assignmentId, propertyId, to } = ctx;
  const problems: string[] = [];

  if (to === 'INSPECTION') {
    const documents = await tx.document.count({ where: { firmId, propertyId } });
    if (documents === 0) problems.push('Upload at least one property document before inspection');
  }

  if (to === 'VALUATION') {
    const inspections = await tx.inspection.count({
      where: { firmId, assignmentId, status: { in: ['SUBMITTED', 'REVIEWED'] } },
    });
    if (inspections === 0) problems.push('Submit at least one inspection before valuation');
  }

  if (to === 'QUALITY_REVIEW' || to === 'APPROVED' || to === 'SUBMITTED' || to === 'CLOSED') {
    const open = await tx.discrepancy.count({
      where: { assignmentId, firmId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } },
    });
    if (open > 0) {
      problems.push(`${open} material discrepanc${open === 1 ? 'y is' : 'ies are'} unresolved; resolve or disclose before continuing`);
    }
  }

  // Always judged on the latest valuation, so a revision cannot ride on the
  // approval of the version it replaces.
  const latest =
    to === 'QUALITY_REVIEW' || to === 'APPROVED'
      ? await tx.valuationVersion.findFirst({
          where: { firmId, assignmentId },
          orderBy: { versionNumber: 'desc' },
          select: { id: true, status: true },
        })
      : null;

  if (to === 'QUALITY_REVIEW' && (!latest || !['IN_REVIEW', 'APPROVED'].includes(latest.status))) {
    problems.push('Send the latest valuation for review before quality review');
  }

  if (to === 'APPROVED') {
    if (!latest || latest.status !== 'APPROVED') problems.push('The latest valuation version must be approved');
    else {
      const report = await tx.reportVersion.count({
        where: { firmId, assignmentId, valuationVersionId: latest.id, status: { in: ['APPROVED', 'ISSUED'] } },
      });
      if (report === 0) problems.push('An approved report for the latest valuation is required');
    }
  }

  if (to === 'SUBMITTED') {
    const issued = await tx.reportVersion.count({ where: { firmId, assignmentId, status: 'ISSUED' } });
    if (issued === 0) problems.push('Issue a report before submission');
  }

  if (to === 'CLOSED') {
    const [valuation, report, submission, inspection, documents] = await Promise.all([
      tx.valuationVersion.count({ where: { firmId, assignmentId, status: 'APPROVED' } }),
      tx.reportVersion.count({ where: { firmId, assignmentId, status: 'ISSUED' } }),
      tx.submission.count({ where: { firmId, assignmentId, deliveryStatus: { not: 'FAILED' } } }),
      tx.inspection.count({ where: { firmId, assignmentId, status: { in: ['SUBMITTED', 'REVIEWED'] } } }),
      tx.document.count({ where: { firmId, propertyId } }),
    ]);
    const openQueries = await tx.bankQuery.count({ where: { firmId, assignmentId, status: 'OPEN' } });
    if (openQueries > 0) problems.push(`${openQueries} bank quer${openQueries === 1 ? 'y is' : 'ies are'} still open`);
    if (valuation === 0) problems.push('Archive is missing an approved valuation');
    if (report === 0) problems.push('Archive is missing an issued report');
    if (submission === 0) problems.push('Archive is missing a submission record');
    if (inspection === 0) problems.push('Archive is missing a submitted inspection');
    if (documents === 0) problems.push('Archive is missing property documents');
  }

  return problems;
}
