import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AREA_BASES, COMMERCIAL_METHODS, PROJECT_USES, TREATMENTS, type AreaBasis, type CommercialMethod, type ProjectUse, type Treatment } from './engines/types.js';

// Decorators only enforce shape and size here. Business rules (positive
// values, decimal places, duplicates, rate basis) live in the engines, which
// are the single source of truth for what a valid input is.

export class RatedAreaDto {
  @IsNumber() areaSqm!: number;
  @IsNumber() ratePerSqm!: number;
  @IsString() @MaxLength(500) rateSource!: string;
}

export class FloorDto {
  @IsString() @MaxLength(120) label!: string;
  @IsNumber() areaSqm!: number;
  @IsNumber() constructionRatePerSqm!: number;
  @IsString() @MaxLength(500) rateSource!: string;
  @IsNumber() ageYears!: number;
  @IsNumber() usefulLifeYears!: number;
  @IsNumber() residualPercent!: number;
}

export class AdjustmentDto {
  @IsString() @MaxLength(120) label!: string;
  @IsNumber() percent!: number;
  @IsString() @MaxLength(500) reason!: string;
}

export class ExtraItemDto {
  @IsString() @MaxLength(120) component!: string;
  @IsNumber() quantity!: number;
  @IsString() @MaxLength(30) unit!: string;
  @IsNumber() rate!: number;
  @IsIn(TREATMENTS) treatment!: Treatment;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string;
}

export class IncomeDto {
  @IsNumber() monthlyRent!: number;
  @IsString() @MaxLength(500) rentSource!: string;
  @IsNumber() vacancyPercent!: number;
  @IsNumber() operatingExpensePercent!: number;
  @IsNumber() capRatePercent!: number;
  @IsString() @MaxLength(500) capRateSource!: string;
}

export class PlantItemDto {
  @IsString() @MaxLength(120) item!: string;
  @IsNumber() quantity!: number;
  @IsNumber() unitCost!: number;
  @IsString() @MaxLength(500) source!: string;
  @IsNumber() ageYears!: number;
  @IsNumber() usefulLifeYears!: number;
  @IsNumber() residualPercent!: number;
}

export class ProjectComponentDto {
  @IsString() @MaxLength(120) label!: string;
  @IsIn(PROJECT_USES) use!: ProjectUse;
  @IsNumber() areaSqm!: number;
  @IsNumber() ratePerSqm!: number;
  @IsString() @MaxLength(500) rateSource!: string;
  @IsNumber() completionPercent!: number;
}

export class ValuationInputDto {
  @IsString() @MaxLength(500) areaSource!: string;
  @IsOptional() @IsString() @MaxLength(4000) assumptions?: string;
  @IsOptional() @IsIn(AREA_BASES) areaBasis?: AreaBasis;
  @IsOptional() @IsIn(AREA_BASES) rateBasis?: AreaBasis;

  // Verified comparables this valuation relies on (evidence trail).
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) comparableIds?: string[];

  @IsOptional() @IsIn(COMMERCIAL_METHODS) commercialMethod?: CommercialMethod;
  @IsOptional() @ValidateNested() @Type(() => IncomeDto) income?: IncomeDto;
  @IsOptional() @IsBoolean() scopeIncludesPlant?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => PlantItemDto) plant?: PlantItemDto[];
  @IsOptional() @IsString() @MaxLength(300) sanctionedPlanRef?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ProjectComponentDto) components?: ProjectComponentDto[];

  @IsOptional() @ValidateNested() @Type(() => RatedAreaDto) unit?: RatedAreaDto;
  @IsOptional() @ValidateNested() @Type(() => RatedAreaDto) land?: RatedAreaDto;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => FloorDto)
  floors?: FloorDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AdjustmentDto)
  adjustments?: AdjustmentDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ExtraItemDto)
  extraItems?: ExtraItemDto[];
}

export class CreateValuationDto extends ValuationInputDto {
  // Required from version 2 onwards.
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) changeReason?: string;
}
