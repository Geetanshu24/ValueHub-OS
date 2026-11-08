import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DOCUMENT_TYPES,
  INTAKE_SOURCES,
  REVIEW_OUTCOMES,
  type IntakeSource,
  type DocumentType,
  type ReviewOutcome,
} from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type!: DocumentType;

  // How the file reached the firm.
  @IsOptional()
  @IsIn(INTAKE_SOURCES)
  source?: IntakeSource;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000)
  pageCount?: number;
}

export class UpdateDocumentDto {
  // Re-classify a file that was uploaded under the wrong type.
  @IsIn(DOCUMENT_TYPES)
  type!: DocumentType;
}

export class ListDocumentsQuery extends PaginationQuery {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @IsIn(DOCUMENT_TYPES) type?: DocumentType;
}

export class SetFieldValueDto {
  @IsString()
  @MaxLength(500)
  value!: string;
}

export class AddExtractedFieldDto {
  // snake_case key such as plot_area_sqm
  @Matches(/^[a-z][a-z0-9_]{1,59}$/, { message: 'fieldKey must be snake_case' })
  fieldKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  extractedValue!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000)
  pageNumber!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class ReviewFieldDto {
  @IsIn(REVIEW_OUTCOMES)
  outcome!: ReviewOutcome;

  // Required when outcome is CORRECTED.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  verifiedValue?: string;
}
