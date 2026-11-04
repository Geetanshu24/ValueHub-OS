import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, StreamableFile } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateReportDto, CreateTemplateDto, SetTemplateActiveDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';
import { TemplatesService } from './templates.service.js';

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly templates: TemplatesService,
  ) {}

  // ---- templates
  @Get('report-templates/source-fields')
  sourceFields() {
    return this.templates.sourceFields();
  }

  @Get('report-templates')
  listTemplates(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Post('report-templates')
  createTemplate(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Post('report-templates/install-defaults')
  @HttpCode(200)
  installDefaults(@CurrentUser() user: AuthUser) {
    return this.templates.installDefaults(user.firmId, user.userId);
  }

  @Get('report-templates/:id')
  getTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(user.firmId, id);
  }

  @Roles('FIRM_ADMIN')
  @Patch('report-templates/:id/active')
  setTemplateActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTemplateActiveDto) {
    return this.templates.setActive(user.firmId, user.userId, id, dto.isActive);
  }

  @Get('assignments/:assignmentId/report-templates')
  templatesFor(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.templates.forAssignment(user.firmId, assignmentId);
  }

  // ---- reports
  @Get('assignments/:assignmentId/reports')
  list(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.reports.list(user.firmId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('assignments/:assignmentId/reports/preview-qc')
  @HttpCode(200)
  previewQc(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: CreateReportDto) {
    return this.reports.previewQc(user.firmId, user, assignmentId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('assignments/:assignmentId/reports')
  create(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: CreateReportDto) {
    return this.reports.create(user.firmId, user, assignmentId, dto);
  }

  @Get('reports/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(user.firmId, id);
  }

  @Get('reports/:id/file')
  file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return this.reports.download(user.firmId, user.userId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('reports/:id/submit-for-review')
  @HttpCode(200)
  submitForReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.submitForReview(user.firmId, user.userId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('reports/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.approve(user.firmId, user, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('reports/:id/issue')
  @HttpCode(200)
  issue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.issue(user.firmId, user, id);
  }
}
