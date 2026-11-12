import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { AiAssistService } from './ai-assist.service.js';

@Controller()
export class AiAssistController {
  constructor(private readonly assist: AiAssistService) {}

  @Get('ai/status')
  status() {
    return this.assist.status();
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post('assignments/:assignmentId/comparison/ai-explain')
  @HttpCode(200)
  explain(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.assist.explainDifferences(user.firmId, user.userId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('assignments/:assignmentId/assumptions/ai')
  @HttpCode(200)
  assumptions(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.assist.draftAssumptions(user.firmId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR')
  @Post('inspections/:inspectionId/ai-observations')
  @HttpCode(200)
  observe(@CurrentUser() user: AuthUser, @Param('inspectionId', ParseUUIDPipe) inspectionId: string) {
    return this.assist.observeFromPhotos(user.firmId, inspectionId);
  }
}
