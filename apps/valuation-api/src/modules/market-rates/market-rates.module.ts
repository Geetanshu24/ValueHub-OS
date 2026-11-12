import { Module } from '@nestjs/common';
import { ComparablesModule } from '../comparables/comparables.module.js';
import { MarketRatesController } from './market-rates.controller.js';
import { MarketRatesService } from './market-rates.service.js';

@Module({ imports: [ComparablesModule], controllers: [MarketRatesController], providers: [MarketRatesService] })
export class MarketRatesModule {}
