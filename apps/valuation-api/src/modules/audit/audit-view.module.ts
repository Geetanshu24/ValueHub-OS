import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { TimelineController } from './timeline.controller.js';

@Module({ controllers: [AuditController, TimelineController] })
export class AuditViewModule {}
