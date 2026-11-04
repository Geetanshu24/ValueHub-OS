import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { DISCREPANCY_RESOLUTIONS, type DiscrepancyResolution } from '@value-hub/valuation-shared';

export class ResolveDiscrepancyDto {
  @IsIn(DISCREPANCY_RESOLUTIONS)
  outcome!: DiscrepancyResolution;

  // Basis relied on, measurement method, or the limitation being disclosed.
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  resolutionNote!: string;
}
