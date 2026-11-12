import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unread(user.firmId, user.userId);
  }

  @Post(':id/seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markSeen(user.firmId, user.userId, id);
  }
}
