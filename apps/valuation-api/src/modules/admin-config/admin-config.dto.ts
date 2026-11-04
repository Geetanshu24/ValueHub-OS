import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PROPERTY_CLASSES, type PropertyClass } from '@value-hub/valuation-shared';

export class UpdateSettingsDto {
  // Set from the applicable law, bank agreements and professional obligations.
  @IsInt() @Min(1) @Max(50) retentionYears!: number;
}

export class CreateFeeRuleDto {
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) amount!: number;
  @IsDateString({ strict: true }) effectiveFrom!: string;
}

export class CreateChecklistItemDto {
  @IsString() @MinLength(3) @MaxLength(300) label!: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class UpdateChecklistItemDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class ChecklistResponseDto {
  @IsBoolean() checked!: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class LegalHoldDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
