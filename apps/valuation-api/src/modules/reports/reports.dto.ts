import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PROPERTY_CLASSES, type PropertyClass } from '@value-hub/valuation-shared';

export class CreateReportDto {
  @IsUUID() templateId!: string;
  // Defaults to the latest valuation version.
  @IsOptional() @IsUUID() valuationVersionId?: string;
  // Required when a report has already been issued for this assignment.
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) changeReason?: string;
  // Draw the report in a bank's own layout (the answers saved on the Bank Report page) instead of the template's own PDF.
  @IsOptional() @IsIn(['BOI', 'PNB', 'SBI']) bankFormat?: 'BOI' | 'PNB' | 'SBI';
}

export class CreateTemplateDto {
  // Reusing a name publishes the next version of that template.
  @IsString() @MinLength(3) @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @IsDateString({ strict: true }) effectiveFrom!: string;
  // Validated against the template schema in the service.
  @IsObject() spec!: Record<string, unknown>;
}

export class SetTemplateActiveDto {
  @Type(() => Boolean) @IsBoolean() isActive!: boolean;
}
