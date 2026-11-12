import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ASSIGNMENT_PRIORITIES,
  ASSIGNMENT_STATUSES,
  INTAKE_SOURCES,
  PROPERTY_CLASSES,
  type AssignmentPriority,
  type AssignmentStatus,
  type IntakeSource,
  type PropertyClass,
} from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class CreateAssignmentDto {
  @IsUUID() bankId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() propertyId!: string;
  @IsUUID() assignedValuerId!: string;
  // The client who asked for the work, and who the valuer hands the case to.
  @IsOptional() @IsString() @MaxLength(30) clientPhone?: string;
  @IsOptional() @IsUUID() assignedDrafterId?: string;
  @IsOptional() @IsUUID() assignedInspectorId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  purpose!: string;

  @IsOptional() @IsString() @MaxLength(1000) scope?: string;

  @IsDateString({ strict: true }) valuationDate!: string;
  @IsDateString({ strict: true }) dueDate!: string;

  // How the instruction arrived, who the borrower is, and when the bank sent it.
  @IsOptional() @IsIn(INTAKE_SOURCES) intakeSource?: IntakeSource;
  @IsOptional() @IsIn(ASSIGNMENT_PRIORITIES) priority?: AssignmentPriority;
  @IsOptional() @IsString() @MaxLength(200) borrowerName?: string;
  @IsOptional() @IsDateString({ strict: true }) instructionDate?: string;

  // Intake details: who at the bank, the loan, the applicant and how the fee is settled.
  @IsOptional() @IsString() @MaxLength(120) bankOfficerName?: string;
  @IsOptional() @IsString() @MaxLength(40) bankOfficerMobile?: string;
  @IsOptional() @IsString() @MaxLength(80) loanAccountNo?: string;
  @IsOptional() @IsString() @MaxLength(120) applicantFatherName?: string;
  @IsOptional() @IsString() @MaxLength(40) applicantMobile?: string;
  @IsOptional() @IsEmail() @MaxLength(200) applicantEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) billingArrangement?: string;
  @IsOptional() @IsString() @MaxLength(1000) specialInstructions?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000_000) approxAreaSqm?: number;

  // The earlier assignment these details were started from (same property).
  @IsOptional() @IsUUID() reusedFromId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  fee?: number;
}

export class UpdateStatusDto {
  @IsIn(ASSIGNMENT_STATUSES)
  status!: AssignmentStatus;
}

export class ListAssignmentsQuery extends PaginationQuery {
  @IsOptional() @IsIn(ASSIGNMENT_STATUSES) status?: AssignmentStatus;
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() assignedValuerId?: string;
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;

  // Matches the assignment code, borrower, property address, khasra number or bank.
  @IsOptional() @IsString() @MaxLength(60) q?: string;

  // Due before today and still open (not submitted, closed or cancelled).
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() overdue?: boolean;
  @IsOptional() @IsDateString({ strict: true }) dueFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dueTo?: string;
}

export class UpdateAssignmentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) purpose?: string;
  @IsOptional() @IsString() @MaxLength(1000) scope?: string;
  @IsOptional() @IsDateString({ strict: true }) valuationDate?: string;
  @IsOptional() @IsDateString({ strict: true }) dueDate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(ASSIGNMENT_PRIORITIES) priority?: AssignmentPriority;
  @IsOptional() @IsString() @MaxLength(200) borrowerName?: string;
  // Reallocation; FIRM_ADMIN only.
  @IsOptional() @IsUUID() assignedValuerId?: string;
  @IsOptional() @IsString() @MaxLength(30) clientPhone?: string;
  @IsOptional() @IsUUID() assignedDrafterId?: string;
  @IsOptional() @IsUUID() assignedInspectorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  fee?: number;
}
