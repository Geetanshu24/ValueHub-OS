import { Module } from '@nestjs/common';
import { DiscrepanciesModule } from '../discrepancies/discrepancies.module.js';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  imports: [DiscrepanciesModule],
  controllers: [InspectionsController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
