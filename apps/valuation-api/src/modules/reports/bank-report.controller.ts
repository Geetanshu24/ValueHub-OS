import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { BankReportAiService } from './bank-report-ai.service.js';
import { BankReportService } from './bank-report.service.js';

@Controller('assignments/:assignmentId/bank-report')
export class BankReportController {
  constructor(
    private readonly bankReport: BankReportService,
    private readonly ai: BankReportAiService,
  ) {}

  @Get()
  form(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.bankReport.form(user.firmId, assignmentId, format);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Put()
  save(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() body: { values?: Record<string, unknown> }, @Query('format') format?: string) {
    return this.bankReport.save(user.firmId, user, assignmentId, body?.values ?? {}, format);
  }

  @Get('docx')
  async docx(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    const { bytes, name, type } = await this.bankReport.file(user.firmId, user, assignmentId, 'docx', format);
    return new StreamableFile(bytes, { type, disposition: `attachment; filename="${name}"` });
  }

  @Get('pdf')
  async pdf(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    const { bytes, name, type } = await this.bankReport.file(user.firmId, user, assignmentId, 'pdf', format);
    return new StreamableFile(bytes, { type, disposition: `attachment; filename="${name}"` });
  }

  // ---- checks and AI help: all only suggest, nothing is saved

  @Get('check')
  check(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.ai.check(user.firmId, assignmentId, format);
  }

  @Get('ai-status')
  aiStatus() {
    return { enabled: this.ai.enabled() };
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('ai/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.ai.review(user.firmId, assignmentId, format);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('ai/draft')
  @HttpCode(200)
  draft(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() body: { keys?: string[] }, @Query('format') format?: string) {
    return this.ai.draft(user.firmId, assignmentId, format, Array.isArray(body?.keys) ? body.keys.filter((k) => typeof k === 'string').slice(0, 30) : undefined);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('ai/photos')
  @HttpCode(200)
  photos(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.ai.photos(user.firmId, assignmentId, format);
  }
}
