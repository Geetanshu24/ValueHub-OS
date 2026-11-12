import { Module } from '@nestjs/common';
import { DiscrepanciesModule } from '../discrepancies/discrepancies.module.js';
import { ComparisonController } from './comparison.controller.js';
import { ComparisonService } from './comparison.service.js';

@Module({ imports: [DiscrepanciesModule], controllers: [ComparisonController], providers: [ComparisonService] })
export class ComparisonModule {}
