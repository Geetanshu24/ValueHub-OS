import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { DashboardService, GROUPINGS, type Grouping } from './dashboard.service.js';

export class SubmittedQuery {
  @IsOptional() @IsString() month?: string;
  @IsOptional() @IsIn(GROUPINGS) groupBy?: Grouping;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.dashboard.overview(user.firmId);
  }

  @Get('work-queue')
  workQueue(@CurrentUser() user: AuthUser) {
    return this.dashboard.workQueue(user);
  }

  @Get('reminders')
  reminders(@CurrentUser() user: AuthUser) {
    return this.dashboard.reminders(user);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Get('workload')
  workload(@CurrentUser() user: AuthUser) {
    return this.dashboard.workload(user.firmId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Get('submitted')
  submitted(@CurrentUser() user: AuthUser, @Query() query: SubmittedQuery) {
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    return this.dashboard.submittedByMonth(user.firmId, month, query.groupBy ?? 'bank');
  }

  @Roles('FIRM_ADMIN', 'REVIEWER')
  @Get('archive-gaps')
  archiveGaps(@CurrentUser() user: AuthUser) {
    return this.dashboard.archiveGaps(user.firmId);
  }
}
