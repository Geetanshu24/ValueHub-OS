import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CreateMarketRateDto, ListMarketRatesQuery, TrendQuery } from './market-rates.dto.js';
import { MarketRatesService } from './market-rates.service.js';

@Controller('market-rates')
export class MarketRatesController {
  constructor(private readonly rates: MarketRatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListMarketRatesQuery) {
    return this.rates.list(user.firmId, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.rates.summary(user.firmId);
  }

  @Get('localities')
  localities(@CurrentUser() user: AuthUser) {
    return this.rates.localities(user.firmId);
  }

  @Get('trend')
  trend(@CurrentUser() user: AuthUser, @Query() query: TrendQuery) {
    return this.rates.trend(user.firmId, query);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMarketRateDto) {
    return this.rates.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post(':id/use-in/:assignmentId')
  @HttpCode(200)
  useIn(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.rates.useIn(user.firmId, user.userId, id, assignmentId);
  }
}
