import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateAssignmentDto, ListAssignmentsQuery, UpdateAssignmentDto, UpdateStatusDto } from './assignments.dto.js';
import { AssignmentsService } from './assignments.service.js';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListAssignmentsQuery) {
    return this.assignments.list(user.firmId, query, user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.get(user.firmId, id, user);
  }

  @Get(':id/readiness')
  readiness(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.readiness(user.firmId, id);
  }

  @Get(':id/inspection-context')
  inspectionContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.inspectionContext(user.firmId, user, id);
  }

  @Get(':id/review-context')
  reviewContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.reviewContext(user.firmId, id);
  }

  @Get(':id/submission-context')
  submissionContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.submissionContext(user.firmId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.assignments.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssignmentDto) {
    return this.assignments.update(user.firmId, user, id, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.assignments.changeStatus(user.firmId, user.userId, id, dto.status);
  }
}
