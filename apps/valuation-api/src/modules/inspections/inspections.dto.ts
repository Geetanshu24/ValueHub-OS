import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AREA_FIELD_KEYS, PHOTO_CATEGORIES, type AreaFieldKey, type PhotoCategory } from '@value-hub/valuation-shared';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';

export class ScheduleInspectionDto {
  @IsUUID() inspectorId!: string;
  @IsDateString({ strict: true }) visitedAt!: string;
}

export class UpdateInspectionDto {
  // Moving a visit: a valuer or admin only, and only until it is submitted.
  @IsOptional() @IsDateString({ strict: true }) visitedAt?: string;
  @IsOptional() @IsUUID() inspectorId?: string;

  // Free-form field notes: use, occupancy, condition, access, services…
  @IsOptional() @IsObject() observations?: Record<string, unknown>;

  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
}

export class AddMeasurementDto {
  @IsString() @MinLength(1) @MaxLength(120) label!: string;

  // Links the measurement to a documented fact so differences are flagged.
  @IsOptional() @IsIn(AREA_FIELD_KEYS) fieldKey?: AreaFieldKey;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000_000)
  areaSqm!: number;

  // How it was measured: tape, laser, plan scaling…
  @IsString() @MinLength(2) @MaxLength(300) method!: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UploadPhotoDto {
  @IsOptional() @IsString() @MaxLength(300) caption?: string;
  @IsOptional() @IsIn(PHOTO_CATEGORIES) category?: PhotoCategory;
  // When the picture was taken, as reported by the device.
  @IsOptional() @IsDateString({ strict: true }) takenAt?: string;
}

export class UpdatePhotoDto {
  @IsOptional() @IsString() @MaxLength(300) caption?: string;
  @IsOptional() @IsIn(PHOTO_CATEGORIES) category?: PhotoCategory;
  @IsOptional() @IsBoolean() captionConfirmed?: boolean;
}

export class ListInspectionsQuery extends PaginationQuery {
  @IsDateString({ strict: true }) from!: string;
  @IsDateString({ strict: true }) to!: string;
  @IsOptional() @IsUUID() inspectorId?: string;
}
