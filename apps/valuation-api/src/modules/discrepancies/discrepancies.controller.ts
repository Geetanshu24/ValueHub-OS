import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ResolveDiscrepancyDto } from './discrepancies.dto.js';
import { DiscrepanciesService } from './discrepancies.service.js';

@Controller()
export class DiscrepanciesController {
  constructor(private readonly discrepancies: DiscrepanciesService) {}

  @Get('assignments/:assignmentId/discrepancies')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.discrepancies.listForAssignment(user.firmId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Patch('discrepancies/:id/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDiscrepancyDto,
  ) {
    return this.discrepancies.resolve(user.firmId, user.userId, id, dto);
  }
}
