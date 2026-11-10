import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_LIMITS } from '@value-hub/valuation-shared';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { DocumentAccessGuard } from '../../common/auth/document-access.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import {
  AddExtractedFieldDto,
  ListDocumentsQuery,
  ReviewFieldDto,
  SetFieldValueDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './documents.dto.js';
import { DocumentsService } from './documents.service.js';

@UseGuards(DocumentAccessGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR')
  @Post('properties/:propertyId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.documents.upload(user.firmId, user.userId, propertyId, dto, file);
  }

  @Get('documents')
  list(@CurrentUser() user: AuthUser, @Query() query: ListDocumentsQuery) {
    return this.documents.list(user.firmId, query);
  }

  @Get('documents/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(user.firmId, id);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Patch('documents/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.update(user.firmId, user.userId, id, dto);
  }

  @Get('documents/:id/file')
  download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return this.documents.download(user.firmId, user.userId, id);
  }

  @Get('documents/:id/fields')
  listFields(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.listFields(user.firmId, id);
  }

  // The drafter's grid: one value per fact per document, saved cell by cell. An empty value clears the cell.
  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Put('documents/:id/fields/:fieldKey')
  setField(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fieldKey') fieldKey: string,
    @Body() dto: SetFieldValueDto,
  ) {
    return this.documents.setFieldValue(user.firmId, user.userId, id, fieldKey, dto.value, { page: dto.page, note: dto.note, unit: dto.unit });
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'DRAFTER')
  @Post('documents/:id/fields/:fieldKey/use')
  useField(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('fieldKey') fieldKey: string) {
    return this.documents.useFieldInReport(user.firmId, user.userId, id, fieldKey);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'INSPECTOR', 'DRAFTER')
  @Post('documents/:id/fields')
  addField(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddExtractedFieldDto,
  ) {
    return this.documents.addField(user.firmId, user.userId, id, dto);
  }

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Patch('document-fields/:fieldId/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: ReviewFieldDto,
  ) {
    return this.documents.reviewField(user.firmId, user.userId, fieldId, dto);
  }
}
