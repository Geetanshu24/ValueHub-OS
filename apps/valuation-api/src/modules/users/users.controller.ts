import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Active colleagues, for assignee / inspector pickers.
  @Get('staff')
  staff(@CurrentUser() user: AuthUser) {
    return this.users.staff(user.firmId);
  }

  @Roles('FIRM_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersQuery) {
    return this.users.list(user.firmId, query);
  }

  @Roles('FIRM_ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user.firmId, user.userId, id, dto);
  }
}
