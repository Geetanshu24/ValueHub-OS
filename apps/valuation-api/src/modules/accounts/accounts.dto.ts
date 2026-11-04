import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

const money = () => [Type(() => Number), IsNumber({ maxDecimalPlaces: 2 }), Min(0.01), Max(1_000_000_000)];
const apply = (decorators: PropertyDecorator[]) => (target: object, key: string) => decorators.forEach((d) => d(target, key));

export class CreateInvoiceDto {
  // Defaults to whatever fee remains un-invoiced on the assignment.
  @IsOptional() @apply(money() as PropertyDecorator[]) amount?: number;
  @IsOptional() @IsDateString({ strict: true }) issuedOn?: string;
  @IsDateString({ strict: true }) dueOn!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RecordPaymentDto {
  @apply(money() as PropertyDecorator[]) amount!: number;
  @IsDateString({ strict: true }) receivedOn!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
}

export class VoidDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class FollowUpDto {
  @IsIn(['EMAIL', 'CALL', 'VISIT', 'OTHER']) channel!: 'EMAIL' | 'CALL' | 'VISIT' | 'OTHER';
  @IsString() @MinLength(3) @MaxLength(1000) note!: string;
  @IsOptional() @IsDateString({ strict: true }) nextActionOn?: string;
  // For EMAIL: where to send the reminder.
  @IsOptional() @IsEmail() sendTo?: string;
}

export class ListInvoicesQuery extends PaginationQuery {
  @IsOptional() @IsIn(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']) status?: string;
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() overdue?: boolean;
}
