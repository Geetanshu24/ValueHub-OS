import { Module } from '@nestjs/common';
import { ComparisonModule } from '../comparison/comparison.module.js';
import { AiAssistController } from './ai-assist.controller.js';
import { AiAssistService } from './ai-assist.service.js';

@Module({ imports: [ComparisonModule], controllers: [AiAssistController], providers: [AiAssistService] })
export class AiAssistModule {}
