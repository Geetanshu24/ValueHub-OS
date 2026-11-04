import { Module } from '@nestjs/common';
import { ValuationsController } from './valuations.controller.js';
import { ValuationsService } from './valuations.service.js';

@Module({
  controllers: [ValuationsController],
  providers: [ValuationsService],
})
export class ValuationsModule {}
