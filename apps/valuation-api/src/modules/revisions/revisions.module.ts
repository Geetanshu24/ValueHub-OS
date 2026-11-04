import { Module } from '@nestjs/common';
import { RevisionsController } from './revisions.controller.js';

@Module({ controllers: [RevisionsController] })
export class RevisionsModule {}
