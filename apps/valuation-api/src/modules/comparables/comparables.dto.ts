import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const COMPARABLE_AREA_BASES = ['LAND', 'CARPET', 'BUILT_UP', 'SUPER_BUILT_UP'] as const;

export class CreateComparableDto {
  @IsString() @MinLength(3) @MaxLength(300) location!: string;
  // Where the figure came from: registry, broker call, listing, dealer…
  @IsString() @MinLength(3) @MaxLength(300) source!: string;
  // false = asking price, true = a completed transaction.
  @IsBoolean() isTransaction!: boolean;
  @IsDateString({ strict: true }) observedOn!: string;
  @IsIn(COMPARABLE_AREA_BASES) areaBasis!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000_000)
  ratePerSqm!: number;

  @IsOptional() @IsObject() adjustments?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) relevanceNote?: string;
}

export class VerifyComparableDto {
  @IsBoolean() verified!: boolean;
}
