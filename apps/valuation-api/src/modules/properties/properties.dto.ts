import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PROPERTY_CLASSES, type PropertyClass } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class BoundariesDto {
  @IsOptional() @IsString() @MaxLength(200) north?: string;
  @IsOptional() @IsString() @MaxLength(200) south?: string;
  @IsOptional() @IsString() @MaxLength(200) east?: string;
  @IsOptional() @IsString() @MaxLength(200) west?: string;
}

export class CreatePropertyDto {
  @IsIn(PROPERTY_CLASSES)
  propertyClass!: PropertyClass;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  addressLine!: string;

  @IsOptional() @IsString() @MaxLength(120) unitDetail?: string;
  @IsOptional() @IsString() @MaxLength(120) locality?: string;
  @IsOptional() @IsString() @MaxLength(120) village?: string;
  @IsOptional() @IsString() @MaxLength(120) tehsil?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pinCode must be 6 digits' })
  pinCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  khasraNumbers?: string[];

  @IsOptional() @ValidateNested() @Type(() => BoundariesDto) boundaries?: BoundariesDto;
}

export class ListPropertiesQuery extends PaginationQuery {
  // Matches code, address, locality, village, district or any khasra number.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PROPERTY_CLASSES)
  propertyClass?: PropertyClass;

  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) locality?: string;
}

export class UpdatePropertyDto {
  @IsOptional() @IsIn(PROPERTY_CLASSES) propertyClass?: PropertyClass;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(120) unitDetail?: string;
  @IsOptional() @IsString() @MaxLength(120) locality?: string;
  @IsOptional() @IsString() @MaxLength(120) village?: string;
  @IsOptional() @IsString() @MaxLength(120) tehsil?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @Matches(/^\d{6}$/, { message: 'pinCode must be 6 digits' }) pinCode?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true }) khasraNumbers?: string[];
  @IsOptional() @ValidateNested() @Type(() => BoundariesDto) boundaries?: BoundariesDto;
}
