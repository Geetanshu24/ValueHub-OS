import { Controller, Get, HttpCode, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UPLOAD_LIMITS } from '@value-hub/valuation-shared';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { PreviousWorkQuery } from './intake.dto.js';
import { IntakeService } from './intake.service.js';

@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  // Runs in the request, like OCR: fine for a handful of pages.
  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('extract')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: UPLOAD_LIMITS.documentBytes } }))
  extract(@CurrentUser() user: AuthUser, @UploadedFiles() files: Express.Multer.File[] | undefined) {
    return this.intake.extract(user.firmId, files ?? []);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Post('extract-deed')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: UPLOAD_LIMITS.documentBytes } }))
  extractDeed(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    return this.intake.extractDeed(files ?? []);
  }

  @Roles('FIRM_ADMIN', 'VALUER')
  @Get('previous-work')
  previousWork(@CurrentUser() user: AuthUser, @Query() query: PreviousWorkQuery) {
    return this.intake.previousWork(user.firmId, query);
  }
}
