import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { VALUATION_ROLES, type ValuationRole } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsIn(VALUATION_ROLES) role!: ValuationRole;
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsIn(VALUATION_ROLES) role?: ValuationRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Admin password reset.
  @IsOptional() @IsString() @MinLength(12) @MaxLength(200) password?: string;
}

export class ListUsersQuery extends PaginationQuery {}
