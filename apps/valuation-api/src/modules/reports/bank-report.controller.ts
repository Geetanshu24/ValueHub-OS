import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssignmentAccessGuard } from '../../common/auth/assignment-access.guard.js';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { BankReportAiService } from './bank-report-ai.service.js';
import { BankReportService } from './bank-report.service.js';

class DecideDto {
  @IsIn(['DOCUMENT_CORRECT', 'SITE_CORRECT', 'EXPLAINED', 'NOT_APPLICABLE', 'NOT_AVAILABLE']) outcome!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

@UseGuards(AssignmentAccessGuard)
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

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Put()
  save(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() body: { values?: Record<string, unknown> }, @Query('format') format?: string) {
    return this.bankReport.save(user.firmId, user, assignmentId, body?.values ?? {}, format);
  }

  // The drafter says the draft is finished; whoever gave them the case gets a pop-up to check it.
  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Post('ready')
  @HttpCode(200)
  ready(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.bankReport.sendForChecking(user.firmId, user.userId, assignmentId);
  }

  @Get('progress')
  progress(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.bankReport.progress(user.firmId, assignmentId);
  }

  @Get('compare')
  compare(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.bankReport.compare(user.firmId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Put('compare/:factKey')
  decide(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Param('factKey') factKey: string, @Body() dto: DecideDto) {
    return this.bankReport.decide(user.firmId, user.userId, assignmentId, factKey, dto);
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

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Post('ai/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.ai.review(user.firmId, assignmentId, format);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Post('ai/draft')
  @HttpCode(200)
  draft(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() body: { keys?: string[] }, @Query('format') format?: string) {
    return this.ai.draft(user.firmId, assignmentId, format, Array.isArray(body?.keys) ? body.keys.filter((k) => typeof k === 'string').slice(0, 30) : undefined);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Post('ai/photos')
  @HttpCode(200)
  photos(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query('format') format?: string) {
    return this.ai.photos(user.firmId, assignmentId, format);
  }
}
