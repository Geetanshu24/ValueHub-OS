import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ChecklistResponseDto, CreateChecklistItemDto, CreateFeeRuleDto, LegalHoldDto, UpdateChecklistItemDto, UpdateSettingsDto } from './admin-config.dto.js';
import { AdminConfigService } from './admin-config.service.js';

@Controller()
export class AdminConfigController {
  constructor(private readonly config: AdminConfigService) {}

  @Roles('FIRM_ADMIN')
  @Get('admin/settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.config.getSettings(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Put('admin/settings/retention')
  setRetention(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.config.setRetention(user.firmId, user.userId, dto.retentionYears);
  }

  @Roles('FIRM_ADMIN')
  @Get('admin/fee-rules')
  feeRules(@CurrentUser() user: AuthUser) {
    return this.config.listFeeRules(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Post('admin/fee-rules')
  createFeeRule(@CurrentUser() user: AuthUser, @Body() dto: CreateFeeRuleDto) {
    return this.config.createFeeRule(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Delete('admin/fee-rules/:id')
  deleteFeeRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteFeeRule(user.firmId, user.userId, id);
  }

  @Get('admin/checklist')
  checklist(@CurrentUser() user: AuthUser) {
    return this.config.listChecklist(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Post('admin/checklist')
  createChecklistItem(@CurrentUser() user: AuthUser, @Body() dto: CreateChecklistItemDto) {
    return this.config.createChecklistItem(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Patch('admin/checklist/:id')
  updateChecklistItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChecklistItemDto) {
    return this.config.updateChecklistItem(user.firmId, user.userId, id, dto);
  }

  @Get('reports/:id/checklist')
  reportChecklist(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.reportChecklist(user.firmId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Put('reports/:id/checklist/:itemId')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ChecklistResponseDto,
  ) {
    return this.config.respond(user.firmId, user.userId, id, itemId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Get('admin/retention')
  retention(@CurrentUser() user: AuthUser) {
    return this.config.retentionReport(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Post('admin/retention/apply')
  @HttpCode(200)
  applyRetention(@CurrentUser() user: AuthUser) {
    return this.config.applyRetentionToClosed(user.firmId, user.userId);
  }

  @Roles('FIRM_ADMIN')
  @Post('assignments/:id/legal-hold')
  @HttpCode(200)
  hold(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LegalHoldDto) {
    return this.config.setLegalHold(user.firmId, user.userId, id, true, dto.reason);
  }

  @Roles('FIRM_ADMIN')
  @Post('assignments/:id/legal-hold/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LegalHoldDto) {
    return this.config.setLegalHold(user.firmId, user.userId, id, false, dto.reason);
  }
}
