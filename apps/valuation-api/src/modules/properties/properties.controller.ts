import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreatePropertyDto, ListPropertiesQuery, UpdatePropertyDto } from './properties.dto.js';
import { PropertiesService } from './properties.service.js';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListPropertiesQuery) {
    return this.properties.list(user.firmId, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.get(user.firmId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.properties.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePropertyDto) {
    return this.properties.update(user.firmId, user.userId, id, dto);
  }
}
