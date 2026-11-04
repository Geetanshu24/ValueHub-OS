import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateInvoiceDto, FollowUpDto, ListInvoicesQuery, RecordPaymentDto, VoidDto } from './accounts.dto.js';
import { AccountsService } from './accounts.service.js';

const MONEY_ROLES = ['FIRM_ADMIN', 'ACCOUNTS'] as const;

@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Roles(...MONEY_ROLES, 'VALUER', 'REVIEWER')
  @Get('invoices')
  list(@CurrentUser() user: AuthUser, @Query() query: ListInvoicesQuery) {
    return this.accounts.list(user.firmId, query);
  }

  @Roles(...MONEY_ROLES, 'VALUER', 'REVIEWER')
  @Get('accounts/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.accounts.summary(user.firmId);
  }

  @Roles(...MONEY_ROLES, 'VALUER', 'REVIEWER')
  @Get('invoices/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(user.firmId, id);
  }

  @Roles(...MONEY_ROLES, 'VALUER', 'REVIEWER')
  @Get('invoices/:id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { fileName, buffer } = await this.accounts.pdf(user.firmId, id);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `attachment; filename="${fileName}"` });
  }

  @Roles(...MONEY_ROLES)
  @Post('assignments/:assignmentId/invoices')
  create(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: CreateInvoiceDto) {
    return this.accounts.create(user.firmId, user.userId, assignmentId, dto);
  }

  @Roles(...MONEY_ROLES)
  @Post('invoices/:id/send')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.send(user.firmId, user.userId, id);
  }

  @Roles('FIRM_ADMIN')
  @Post('invoices/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.accounts.cancel(user.firmId, user.userId, id, dto.reason);
  }

  @Roles(...MONEY_ROLES)
  @Post('invoices/:id/payments')
  recordPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.accounts.recordPayment(user.firmId, user.userId, id, dto);
  }

  @Roles('FIRM_ADMIN')
  @Post('payments/:id/void')
  @HttpCode(200)
  voidPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.accounts.voidPayment(user.firmId, user.userId, id, dto.reason);
  }

  @Roles(...MONEY_ROLES)
  @Post('invoices/:id/follow-ups')
  followUp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FollowUpDto) {
    return this.accounts.followUp(user.firmId, user.userId, id, dto);
  }
}
