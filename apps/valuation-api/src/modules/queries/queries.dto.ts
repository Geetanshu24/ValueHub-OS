import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';
import { Transform } from 'class-transformer';

export const QUERY_KINDS = ['QUERY', 'REVISION_REQUEST'] as const;
export const QUERY_STATUSES = ['OPEN', 'RESPONDED', 'CLOSED'] as const;
export const EVIDENCE_TYPES = ['document', 'report', 'valuation', 'photo', 'inspection', 'comparable'] as const;

export class CreateQueryDto {
  @IsIn(QUERY_KINDS) kind!: (typeof QUERY_KINDS)[number];
  @IsString() @MinLength(5) @MaxLength(4000) question!: string;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsDateString() receivedAt?: string;
}

export class EvidenceRefDto {
  @IsIn(EVIDENCE_TYPES) type!: (typeof EVIDENCE_TYPES)[number];
  @IsUUID() id!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RespondDto {
  @IsString() @MinLength(5) @MaxLength(8000) response!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => EvidenceRefDto) evidence?: EvidenceRefDto[];
  // Email the response to the bank as well as recording it.
  @IsOptional() @IsEmail() sendTo?: string;
}

export class EscalateDto {
  @IsString() @MinLength(5) @MaxLength(1000) note!: string;
}

export class ListQueriesQuery extends PaginationQuery {
  @IsOptional() @IsIn(QUERY_STATUSES) status?: (typeof QUERY_STATUSES)[number];
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() overdue?: boolean;
}
