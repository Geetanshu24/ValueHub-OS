import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PROPERTY_CLASSES, type PropertyClass } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class PreviousWorkQuery extends PaginationQuery {
  // Matches report number, address, locality, district or property code.
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) locality?: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;

  // Only reports issued in the last N years.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) years?: number;
}
