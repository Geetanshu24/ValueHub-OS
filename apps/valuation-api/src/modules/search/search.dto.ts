import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ASSIGNMENT_STATUSES, DOCUMENT_TYPES, PROPERTY_CLASSES, type AssignmentStatus, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export const DATE_FIELDS = ['received', 'valuation', 'due', 'inspection', 'submission', 'invoice'] as const;

export class SearchQuery extends PaginationQuery {
  // Free text: IDs, address, khasra, bank, and the words inside uploaded documents.
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() assignedValuerId?: string;
  @IsOptional() @IsIn(ASSIGNMENT_STATUSES) status?: AssignmentStatus;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @IsOptional() @IsIn(DOCUMENT_TYPES) documentType?: DocumentType;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) tehsil?: string;
  @IsOptional() @IsString() @MaxLength(120) village?: string;
  @IsOptional() @IsString() @MaxLength(10) pinCode?: string;
  @IsOptional() @IsIn(DATE_FIELDS) dateField?: (typeof DATE_FIELDS)[number];
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
}
