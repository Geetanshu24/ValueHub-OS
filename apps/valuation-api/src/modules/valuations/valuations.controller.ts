import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateValuationDto, ValuationInputDto } from './valuations.dto.js';
import { ValuationsService } from './valuations.service.js';

@Controller()
export class ValuationsController {
  constructor(private readonly valuations: ValuationsService) {}

  @Get('assignments/:assignmentId/valuations')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.valuations.list(user.firmId, assignmentId);
  }

  @Get('assignments/:assignmentId/valuation-context')
  context(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.valuations.context(user.firmId, assignmentId);
  }

  // Calculates without saving, so the valuer can see the workings first.
  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('assignments/:assignmentId/valuations/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: ValuationInputDto,
  ) {
    return this.valuations.preview(user.firmId, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('assignments/:assignmentId/valuations')
  create(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateValuationDto,
  ) {
    return this.valuations.create(user.firmId, user.userId, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('valuations/:id/submit-for-review')
  @HttpCode(200)
  submitForReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.valuations.submitForReview(user.firmId, user.userId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('valuations/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.valuations.approve(user.firmId, user, id);
  }
}
