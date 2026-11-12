import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { LifecycleService } from './lifecycle.service.js';

@Controller('assignments/:assignmentId/lifecycle')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.lifecycle.get(user.firmId, assignmentId);
  }
}
