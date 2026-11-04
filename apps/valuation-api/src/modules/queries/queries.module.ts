import { Module } from '@nestjs/common';
import { QueriesController } from './queries.controller.js';
import { QueriesService } from './queries.service.js';
import { QueryDraftService } from './query-draft.service.js';

@Module({
  controllers: [QueriesController],
  providers: [QueriesService, QueryDraftService],
})
export class QueriesModule {}
