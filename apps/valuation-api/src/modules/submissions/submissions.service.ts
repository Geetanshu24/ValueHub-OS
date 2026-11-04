import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { canTransition } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unmetGates } from '../assignments/assignment-gates.js';
import type { AcknowledgeDto, CreateSubmissionDto } from './submissions.dto.js';

const submissionSelect = {
  id: true,
  assignmentId: true,
  reportVersionId: true,
  channel: true,
  recipient: true,
  sentAt: true,
  deliveryStatus: true,
  deliveryError: true,
  messageId: true,
  acknowledgedAt: true,
  note: true,
  reportVersion: { select: { versionNumber: true } },
} satisfies Prisma.SubmissionSelect;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async list(firmId: string, assignmentId: string) {
    await this.requireAssignment(firmId, assignmentId);
    return this.prisma.submission.findMany({
      where: { assignmentId, firmId },
      select: submissionSelect,
      orderBy: { sentAt: 'desc' },
      take: 100,
    });
  }

  // Records a delivery of an issued report. For EMAIL the system sends it;
  // other channels are logged by whoever did the sending. Either way the
  // result is a record, not a promise that the bank received it.
  async create(firmId: string, actorId: string, assignmentId: string, dto: CreateSubmissionDto) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { status: true, code: true, property: { select: { code: true, addressLine: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const report = await this.prisma.reportVersion.findFirst({
      where: { id: dto.reportVersionId, assignmentId, firmId },
      select: { status: true, storageKey: true, versionNumber: true },
    });
    if (!report) throw new BadRequestException('That report does not belong to this assignment');
    if (report.status !== 'ISSUED') throw new ConflictException(`Only an ISSUED report can be submitted, not ${report.status}`);

    if (dto.channel === 'EMAIL') {
      if (!EMAIL_PATTERN.test(dto.recipient)) throw new BadRequestException('recipient must be an email address for the EMAIL channel');
      if (!this.mail.isConfigured) throw new ConflictException('Email is not configured on this server; record the submission under another channel');
    }

    let deliveryStatus: 'RECORDED' | 'SENT' | 'FAILED' = 'RECORDED';
    let deliveryError: string | undefined;
    let messageId: string | undefined;
    if (dto.channel === 'EMAIL') {
      try {
        const sent = await this.mail.send({
          to: dto.recipient,
          subject: `Valuation report ${assignment.code} – ${assignment.property.code}`,
          text: `Please find attached the valuation report ${assignment.code}-R${report.versionNumber} for ${assignment.property.addressLine}.${dto.note ? `\n\n${dto.note}` : ''}`,
          attachments: [{ filename: `${assignment.code}-R${report.versionNumber}.pdf`, content: await this.storage.read(report.storageKey), contentType: 'application/pdf' }],
        });
        deliveryStatus = 'SENT';
        messageId = sent.messageId;
      } catch (error) {
        deliveryStatus = 'FAILED';
        deliveryError = (error as Error).message.slice(0, 500);
        this.logger.warn(`Email submission failed for ${assignment.code}: ${deliveryError}`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          firmId,
          assignmentId,
          reportVersionId: dto.reportVersionId,
          channel: dto.channel,
          recipient: dto.recipient,
          note: dto.note,
          sentAt: new Date(),
          sentById: actorId,
          deliveryStatus,
          deliveryError,
          messageId,
        },
        select: submissionSelect,
      });
      await this.audit.record(
        { firmId, actorId, entityType: 'Submission', entityId: submission.id, action: `submission.${deliveryStatus.toLowerCase()}`, metadata: { channel: dto.channel, recipient: dto.recipient } },
        tx,
      );

      // The first successful hand-over moves an approved assignment to SUBMITTED.
      let advanced = false;
      if (deliveryStatus !== 'FAILED' && assignment.status === 'APPROVED') {
        const current = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { propertyId: true } });
        const problems = await unmetGates(tx, { firmId, assignmentId, propertyId: current.propertyId, to: 'SUBMITTED' });
        if (problems.length === 0 && canTransition('APPROVED', 'SUBMITTED')) {
          await tx.assignment.updateMany({ where: { id: assignmentId, firmId, status: 'APPROVED' }, data: { status: 'SUBMITTED' } });
          await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'assignment.status_changed', metadata: { from: 'APPROVED', to: 'SUBMITTED', via: 'submission' } }, tx);
          advanced = true;
        }
      }
      return { submission, assignmentAdvanced: advanced };
    });
  }

  // The bank's acknowledgement is recorded by a person; nothing infers it.
  async acknowledge(firmId: string, actorId: string, id: string, dto: AcknowledgeDto) {
    const existing = await this.prisma.submission.findFirst({ where: { id, firmId }, select: { deliveryStatus: true, acknowledgedAt: true } });
    if (!existing) throw new NotFoundException('Submission not found');
    if (existing.deliveryStatus === 'FAILED') throw new ConflictException('A failed delivery cannot be acknowledged');
    const at = dto.acknowledgedAt ? new Date(dto.acknowledgedAt) : new Date();
    if (at > new Date(Date.now() + 60_000)) throw new BadRequestException('acknowledgedAt cannot be in the future');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.submission.update({ where: { id }, data: { acknowledgedAt: at, ...(dto.note && { note: dto.note }) }, select: submissionSelect });
      await this.audit.record({ firmId, actorId, entityType: 'Submission', entityId: id, action: 'submission.acknowledged' }, tx);
      return updated;
    });
  }

  private async requireAssignment(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { id: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
  }
}
