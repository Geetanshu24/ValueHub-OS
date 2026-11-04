import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { AcknowledgeDto, CreateSubmissionDto } from './submissions.dto.js';
import { SubmissionsService } from './submissions.service.js';

@Controller()
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('assignments/:assignmentId/submissions')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.submissions.list(user.firmId, assignmentId);
  }

  // Sends or records an external hand-over, so only authorised staff may do it.
  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('assignments/:assignmentId/submissions')
  create(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: CreateSubmissionDto) {
    return this.submissions.create(user.firmId, user.userId, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('submissions/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcknowledgeDto) {
    return this.submissions.acknowledge(user.firmId, user.userId, id, dto);
  }
}
