import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_LIMITS } from '@value-hub/valuation-shared';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import {
  AddMeasurementDto,
  ListInspectionsQuery,
  ScheduleInspectionDto,
  UpdateInspectionDto,
  UpdatePhotoDto,
  UploadPhotoDto,
} from './inspections.dto.js';
import { InspectionsService } from './inspections.service.js';

const FIELD_ROLES = ['FIRM_ADMIN', 'VALUER', 'INSPECTOR'] as const;

@Controller()
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get('inspections')
  calendar(@CurrentUser() user: AuthUser, @Query() query: ListInspectionsQuery) {
    return this.inspections.calendar(user, query);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR')
  @Post('assignments/:assignmentId/inspections')
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: ScheduleInspectionDto,
  ) {
    return this.inspections.schedule(user.firmId, user.userId, assignmentId, dto, user.role);
  }

  @Get('assignments/:assignmentId/inspections')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.inspections.listForAssignment(user.firmId, user, assignmentId);
  }

  @Roles(...FIELD_ROLES)
  @Patch('inspections/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInspectionDto) {
    return this.inspections.update(user, id, dto);
  }

  @Roles(...FIELD_ROLES)
  @Post('inspections/:id/measurements')
  addMeasurement(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMeasurementDto) {
    return this.inspections.addMeasurement(user, id, dto);
  }

  @Roles(...FIELD_ROLES)
  @Post('inspections/:id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.photoBytes, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.inspections.addPhoto(user, id, dto, file);
  }

  @Roles(...FIELD_ROLES)
  @Delete('inspection-measurements/:measurementId')
  removeMeasurement(@CurrentUser() user: AuthUser, @Param('measurementId', ParseUUIDPipe) measurementId: string) {
    return this.inspections.removeMeasurement(user, measurementId);
  }

  @Roles(...FIELD_ROLES)
  @Delete('inspection-photos/:photoId')
  removePhoto(@CurrentUser() user: AuthUser, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.inspections.removePhoto(user, photoId);
  }

  @Roles(...FIELD_ROLES)
  @Patch('inspection-photos/:photoId')
  updatePhoto(@CurrentUser() user: AuthUser, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: UpdatePhotoDto) {
    return this.inspections.updatePhoto(user, photoId, dto);
  }

  @Get('inspection-photos/:photoId/file')
  photo(@CurrentUser() user: AuthUser, @Param('photoId', ParseUUIDPipe) photoId: string): Promise<StreamableFile> {
    return this.inspections.downloadPhoto(user, photoId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('inspections/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.review(user, id);
  }

  @Roles(...FIELD_ROLES)
  @Post('inspections/:id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.submit(user, id);
  }
}
