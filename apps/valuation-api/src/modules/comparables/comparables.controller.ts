import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AssignmentAccessGuard } from '../../common/auth/assignment-access.guard.js';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateComparableDto, VerifyComparableDto } from './comparables.dto.js';
import { ComparablesService } from './comparables.service.js';

@UseGuards(AssignmentAccessGuard)
@Controller()
export class ComparablesController {
  constructor(private readonly comparables: ComparablesService) {}

  @Get('assignments/:assignmentId/comparables')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.comparables.list(user.firmId, assignmentId);
  }

  @Get('assignments/:assignmentId/comparables/summary')
  summary(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.comparables.summary(user.firmId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR')
  @Post('assignments/:assignmentId/comparables')
  create(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateComparableDto,
  ) {
    return this.comparables.create(user.firmId, user.userId, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Patch('comparables/:id/verify')
  verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyComparableDto) {
    return this.comparables.setVerified(user.firmId, user, id, dto.verified);
  }
}
