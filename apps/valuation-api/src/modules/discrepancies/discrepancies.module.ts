import { Module } from '@nestjs/common';
import { DiscrepanciesController } from './discrepancies.controller.js';
import { DiscrepanciesService } from './discrepancies.service.js';

@Module({
  controllers: [DiscrepanciesController],
  providers: [DiscrepanciesService],
  exports: [DiscrepanciesService],
})
export class DiscrepanciesModule {}
