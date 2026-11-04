import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateQueryDto, EscalateDto, ListQueriesQuery, RespondDto } from './queries.dto.js';
import { QueriesService } from './queries.service.js';
import { QueryDraftService } from './query-draft.service.js';

@Controller()
export class QueriesController {
  constructor(
    private readonly queries: QueriesService,
    private readonly drafts: QueryDraftService,
  ) {}

  @Get('queries')
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueriesQuery) {
    return this.queries.list(user.firmId, query);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('assignments/:assignmentId/queries')
  create(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: CreateQueryDto) {
    return this.queries.create(user.firmId, user.userId, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('queries/:id/escalate')
  @HttpCode(200)
  escalate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscalateDto) {
    return this.queries.escalate(user.firmId, user.userId, id, dto);
  }

  // A starting point for the reply; nothing is saved or sent.
  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('queries/:id/draft-reply')
  @HttpCode(200)
  draftReply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.draft(user.firmId, id);
  }

  // Answers go to the bank, so only authorised staff may send them.
  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('queries/:id/respond')
  @HttpCode(200)
  respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.queries.respond(user.firmId, user.userId, id, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('queries/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.close(user.firmId, user.userId, id);
  }
}
