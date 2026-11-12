import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PROPERTY_CLASSES, type PropertyClass } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';
import { RATE_KINDS, RATE_UNITS } from './rates.js';

export class CreateMarketRateDto {
  @IsString() @MinLength(3) @MaxLength(200) locality!: string;
  @IsIn(PROPERTY_CLASSES) propertyClass!: PropertyClass;
  @IsIn(RATE_KINDS) kind!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) rate!: number;
  @IsIn(RATE_UNITS) unit!: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) rateLow?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) rateHigh?: number;
  @IsDateString({ strict: true }) observedOn!: string;
  @IsString() @MinLength(2) @MaxLength(300) source!: string;
  @IsOptional() @IsString() @MaxLength(1000) detail?: string;
}

export class ListMarketRatesQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @IsOptional() @IsIn(RATE_KINDS) kind?: string;
}

export class TrendQuery {
  @IsString() @MaxLength(200) locality!: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
}
