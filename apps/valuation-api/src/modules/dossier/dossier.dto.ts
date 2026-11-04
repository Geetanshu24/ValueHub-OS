import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

export class RedactionDto {
  // Leave out invoices, payments and fee figures.
  @IsOptional() @IsBoolean() fees?: boolean;
  // Strip site GPS coordinates from inspection data.
  @IsOptional() @IsBoolean() gps?: boolean;
  // Leave out the audit trail, escalation notes and checklist ticks.
  @IsOptional() @IsBoolean() internal?: boolean;
}

export class BuildDossierDto {
  // Item ids from the plan, e.g. "report:<uuid>", "document:<uuid>", "audit".
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @IsString({ each: true }) items!: string[];
  @IsOptional() @ValidateNested() @Type(() => RedactionDto) redact?: RedactionDto;
}
