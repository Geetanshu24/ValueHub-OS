import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ComparisonService } from './comparison.service.js';

@Controller('assignments/:assignmentId/comparison')
export class ComparisonController {
  constructor(private readonly comparison: ComparisonService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.comparison.get(user.firmId, user.userId, assignmentId);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post(':rowKey/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Param('rowKey') rowKey: string, @Body() body: { treatment: string; note: string }) {
    return this.comparison.resolve(user.firmId, user.userId, assignmentId, rowKey, body);
  }
}
