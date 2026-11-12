import { Module } from '@nestjs/common';
import { ComparablesController } from './comparables.controller.js';
import { ComparablesService } from './comparables.service.js';

@Module({
  controllers: [ComparablesController],
  providers: [ComparablesService],
  exports: [ComparablesService],
})
export class ComparablesModule {}
