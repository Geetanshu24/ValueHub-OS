import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { DocumentAccessGuard } from '../../common/auth/document-access.guard.js';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { OcrService } from './ocr.service.js';

@UseGuards(DocumentAccessGuard)
@Controller()
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  // Runs in the request: fine for a few pages. A queue is the next step for bulk or large scans.
  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR')
  @Post('documents/:id/ocr')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ocr.run(user.firmId, user.userId, id);
  }
}
