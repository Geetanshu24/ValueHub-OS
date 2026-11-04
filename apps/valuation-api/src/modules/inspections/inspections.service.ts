import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { UPLOAD_LIMITS, type Paginated } from '@value-hub/valuation-shared';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { requireFile } from '../../common/storage/file-validation.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service.js';
import type {
  AddMeasurementDto,
  ListInspectionsQuery,
  ScheduleInspectionDto,
  UpdateInspectionDto,
  UpdatePhotoDto,
  UploadPhotoDto,
} from './inspections.dto.js';

const MAX_PHOTOS_PER_INSPECTION = 100;
const MAX_MEASUREMENTS_PER_INSPECTION = 100;
const MAX_OBSERVATIONS_BYTES = 20_000;

const inspectionSelect = {
  id: true,
  assignmentId: true,
  inspectorId: true,
  visitedAt: true,
  latitude: true,
  longitude: true,
  observations: true,
  status: true,
  inspector: { select: { id: true, fullName: true } },
  measurements: {
    select: { id: true, label: true, fieldKey: true, areaSqm: true, method: true, note: true },
    orderBy: { label: 'asc' },
  },
  photos: {
    select: { id: true, caption: true, category: true, captionConfirmed: true, mimeType: true, takenAt: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.InspectionSelect;

const CLOSED_ASSIGNMENT_STATUSES = ['CLOSED', 'CANCELLED'] as const;

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly discrepancies: DiscrepanciesService,
  ) {}

  async schedule(firmId: string, actorId: string, assignmentId: string, dto: ScheduleInspectionDto) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { status: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if ((CLOSED_ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)) {
      throw new ConflictException(`Cannot schedule an inspection on a ${assignment.status} assignment`);
    }

    const inspector = await this.prisma.user.findFirst({
      where: { id: dto.inspectorId, firmId, isActive: true, role: { in: ['INSPECTOR', 'VALUER'] } },
      select: { id: true },
    });
    if (!inspector) throw new BadRequestException('Inspector must be an active inspector or valuer in this firm');

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: { firmId, assignmentId, inspectorId: dto.inspectorId, visitedAt: new Date(dto.visitedAt) },
        select: inspectionSelect,
      });
      await this.audit.record(
        { firmId, actorId, entityType: 'Inspection', entityId: inspection.id, action: 'inspection.scheduled' },
        tx,
      );
      return inspection;
    });
  }

  async listForAssignment(firmId: string, user: AuthUser, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { id: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return this.prisma.inspection.findMany({
      where: { assignmentId, firmId, ...(user.role === 'INSPECTOR' && { inspectorId: user.userId }) },
      select: inspectionSelect,
      orderBy: { visitedAt: 'desc' },
      take: 50,
    });
  }

  // Calendar feed: visits in a date range across assignments. Inspectors see
  // only their own.
  async calendar(user: AuthUser, query: ListInspectionsQuery): Promise<Paginated<unknown>> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to < from) throw new BadRequestException('to must not be before from');
    if (to.getTime() - from.getTime() > 93 * 24 * 3600 * 1000) throw new BadRequestException('Range is limited to 93 days');

    const where: Prisma.InspectionWhereInput = {
      firmId: user.firmId,
      visitedAt: { gte: from, lte: to },
      ...(user.role === 'INSPECTOR' ? { inspectorId: user.userId } : query.inspectorId ? { inspectorId: query.inspectorId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inspection.findMany({
        where,
        select: {
          id: true,
          visitedAt: true,
          status: true,
          inspector: { select: { id: true, fullName: true } },
          assignment: { select: { id: true, code: true, property: { select: { addressLine: true } } } },
        },
        orderBy: { visitedAt: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.inspection.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async update(user: AuthUser, id: string, dto: UpdateInspectionDto) {
    const inspection = await this.loadEditable(user, id);
    const moving = dto.visitedAt !== undefined || dto.inspectorId !== undefined;
    if (moving && user.role === 'INSPECTOR') throw new ForbiddenException('Only a valuer or admin can reschedule or reassign a visit');
    if (dto.inspectorId) {
      const inspector = await this.prisma.user.findFirst({
        where: { id: dto.inspectorId, firmId: user.firmId, isActive: true, role: { in: ['INSPECTOR', 'VALUER'] } },
        select: { id: true },
      });
      if (!inspector) throw new BadRequestException('Inspector must be an active inspector or valuer in this firm');
    }
    if (dto.observations && JSON.stringify(dto.observations).length > MAX_OBSERVATIONS_BYTES) {
      throw new BadRequestException('observations is too large');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: {
          ...(dto.observations && { observations: dto.observations as Prisma.InputJsonObject }),
          latitude: dto.latitude,
          longitude: dto.longitude,
          visitedAt: dto.visitedAt ? new Date(dto.visitedAt) : undefined,
          inspectorId: dto.inspectorId,
          // Moving a visit is planning, not fieldwork, so it does not start it.
          status: inspection.status === 'SCHEDULED' && !moving ? 'IN_PROGRESS' : undefined,
        },
        select: inspectionSelect,
      });
      await this.audit.record(
        { firmId: user.firmId, actorId: user.userId, entityType: 'Inspection', entityId: id, action: moving ? 'inspection.rescheduled' : 'inspection.updated' },
        tx,
      );
      return updated;
    });
  }

  async addMeasurement(user: AuthUser, id: string, dto: AddMeasurementDto) {
    const inspection = await this.loadEditable(user, id);

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.inspectionMeasurement.count({ where: { inspectionId: id } });
      if (count >= MAX_MEASUREMENTS_PER_INSPECTION) throw new BadRequestException('Too many measurements');

      const measurement = await tx.inspectionMeasurement.create({
        data: { ...dto, inspectionId: id },
        select: { id: true, label: true, fieldKey: true, areaSqm: true, method: true, note: true },
      });
      if (inspection.status === 'SCHEDULED') {
        await tx.inspection.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      }
      await this.audit.record(
        { firmId: user.firmId, actorId: user.userId, entityType: 'Inspection', entityId: id, action: 'measurement.added' },
        tx,
      );
      return measurement;
    });
  }

  // A wrong entry can be removed until the visit is submitted; the audit trail keeps the record.
  async removeMeasurement(user: AuthUser, measurementId: string) {
    const measurement = await this.prisma.inspectionMeasurement.findFirst({
      where: { id: measurementId, inspection: { firmId: user.firmId } },
      select: { inspectionId: true, label: true, areaSqm: true },
    });
    if (!measurement) throw new NotFoundException('Measurement not found');
    await this.loadEditable(user, measurement.inspectionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.inspectionMeasurement.delete({ where: { id: measurementId } });
      await this.audit.record(
        { firmId: user.firmId, actorId: user.userId, entityType: 'Inspection', entityId: measurement.inspectionId, action: 'measurement.removed', metadata: { label: measurement.label, areaSqm: String(measurement.areaSqm) } },
        tx,
      );
    });
    return { removed: true };
  }

  async removePhoto(user: AuthUser, photoId: string) {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id: photoId, inspection: { firmId: user.firmId } },
      select: { inspectionId: true, storageKey: true, sha256: true },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.loadEditable(user, photo.inspectionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.inspectionPhoto.delete({ where: { id: photoId } });
      await this.audit.record(
        { firmId: user.firmId, actorId: user.userId, entityType: 'InspectionPhoto', entityId: photoId, action: 'photo.removed', metadata: { sha256: photo.sha256 } },
        tx,
      );
    });
    await this.storage.remove(photo.storageKey);
    return { removed: true };
  }

  async addPhoto(user: AuthUser, id: string, dto: UploadPhotoDto, upload: Express.Multer.File | undefined) {
    await this.loadEditable(user, id);
    const { file, mimeType } = requireFile(upload, ['image/jpeg', 'image/png', 'image/webp']);
    if (file.size > UPLOAD_LIMITS.photoBytes) throw new BadRequestException('Photo is too large');

    const stored = await this.storage.save(user.firmId, file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const count = await tx.inspectionPhoto.count({ where: { inspectionId: id } });
        if (count >= MAX_PHOTOS_PER_INSPECTION) throw new BadRequestException('Too many photos');

        const photo = await tx.inspectionPhoto.create({
          data: { inspectionId: id, storageKey: stored.storageKey, sha256: stored.sha256, mimeType, caption: dto.caption, category: dto.category, takenAt: dto.takenAt ? new Date(dto.takenAt) : undefined },
          select: { id: true, caption: true, category: true, captionConfirmed: true, mimeType: true, takenAt: true },
        });
        await this.audit.record(
          { firmId: user.firmId, actorId: user.userId, entityType: 'InspectionPhoto', entityId: photo.id, action: 'photo.added' },
          tx,
        );
        return photo;
      });
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  // The inspector confirms (or corrects) each caption before submission.
  async updatePhoto(user: AuthUser, photoId: string, dto: UpdatePhotoDto) {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id: photoId, inspection: { firmId: user.firmId } },
      select: { inspectionId: true },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.loadEditable(user, photo.inspectionId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspectionPhoto.update({
        where: { id: photoId },
        data: { caption: dto.caption, category: dto.category, captionConfirmed: dto.captionConfirmed },
        select: { id: true, caption: true, category: true, captionConfirmed: true, mimeType: true, takenAt: true },
      });
      await this.audit.record(
        { firmId: user.firmId, actorId: user.userId, entityType: 'InspectionPhoto', entityId: photoId, action: 'photo.updated' },
        tx,
      );
      return updated;
    });
  }

  async downloadPhoto(user: AuthUser, photoId: string): Promise<StreamableFile> {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: {
        id: photoId,
        inspection: { firmId: user.firmId, ...(user.role === 'INSPECTOR' && { inspectorId: user.userId }) },
      },
      select: { storageKey: true, mimeType: true },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return new StreamableFile(await this.storage.open(photo.storageKey), { type: photo.mimeType });
  }

  // Field review: a second person confirms a submitted visit's data.
  async review(user: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, firmId: user.firmId }, select: { status: true, inspectorId: true } });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.status !== 'SUBMITTED') throw new ConflictException(`Only a SUBMITTED inspection can be reviewed, not ${inspection.status}`);
    if (inspection.inspectorId === user.userId && user.role !== 'FIRM_ADMIN') {
      throw new ForbiddenException('An inspection must be reviewed by someone other than the inspector');
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.inspection.updateMany({ where: { id, firmId: user.firmId, status: 'SUBMITTED' }, data: { status: 'REVIEWED' } });
      if (count !== 1) throw new ConflictException('Inspection changed concurrently; reload and retry');
      await this.audit.record({ firmId: user.firmId, actorId: user.userId, entityType: 'Inspection', entityId: id, action: 'inspection.reviewed' }, tx);
      return tx.inspection.findUniqueOrThrow({ where: { id }, select: inspectionSelect });
    });
  }

  // Locks the visit and flags any difference between the measurements and
  // the property's documented areas. Flagging never changes either value.
  async submit(user: AuthUser, id: string) {
    const inspection = await this.loadEditable(user, id);

    return this.prisma.$transaction(async (tx) => {
      const measurementCount = await tx.inspectionMeasurement.count({ where: { inspectionId: id } });
      if (measurementCount === 0) throw new BadRequestException('Add at least one measurement before submitting');
      // A submitted visit is locked, so a caption cannot be confirmed afterwards.
      const unconfirmed = await tx.inspectionPhoto.count({ where: { inspectionId: id, captionConfirmed: false } });
      if (unconfirmed > 0) throw new BadRequestException(`Confirm the caption of ${unconfirmed} photo${unconfirmed === 1 ? '' : 's'} before submitting`);

      const { count } = await tx.inspection.updateMany({
        where: { id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        data: { status: 'SUBMITTED' },
      });
      if (count !== 1) throw new ConflictException('Inspection was already submitted');

      const flagged = await this.discrepancies.detectForInspection(tx, {
        firmId: user.firmId,
        actorId: user.userId,
        assignmentId: inspection.assignmentId,
        propertyId: inspection.propertyId,
        inspectionId: id,
      });
      await this.audit.record(
        {
          firmId: user.firmId,
          actorId: user.userId,
          entityType: 'Inspection',
          entityId: id,
          action: 'inspection.submitted',
          metadata: { discrepanciesFlagged: flagged },
        },
        tx,
      );
      return { inspection: await tx.inspection.findUniqueOrThrow({ where: { id }, select: inspectionSelect }), discrepanciesFlagged: flagged };
    });
  }

  // Inspectors may only touch their own visits, and nobody edits a visit
  // after it is submitted.
  private async loadEditable(user: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, firmId: user.firmId },
      select: { id: true, status: true, inspectorId: true, assignmentId: true, assignment: { select: { propertyId: true } } },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (user.role === 'INSPECTOR' && inspection.inspectorId !== user.userId) {
      throw new ForbiddenException('This inspection is assigned to someone else');
    }
    if (inspection.status === 'SUBMITTED' || inspection.status === 'REVIEWED') {
      throw new ConflictException('Inspection has been submitted and can no longer be edited');
    }
    return {
      status: inspection.status,
      assignmentId: inspection.assignmentId,
      propertyId: inspection.assignment.propertyId,
    };
  }
}
