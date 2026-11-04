import { Global, Module } from '@nestjs/common';
import { IdsService } from './ids.service.js';

@Global()
@Module({
  providers: [IdsService],
  exports: [IdsService],
})
export class IdsModule {}
