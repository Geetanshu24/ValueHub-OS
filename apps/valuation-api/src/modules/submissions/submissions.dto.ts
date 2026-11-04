import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const CHANNELS = ['EMAIL', 'PORTAL', 'COURIER', 'HAND_DELIVERY'] as const;
export type Channel = (typeof CHANNELS)[number];

export class CreateSubmissionDto {
  @IsUUID() reportVersionId!: string;
  @IsIn(CHANNELS) channel!: Channel;
  // An email address for EMAIL; otherwise who or where it went (portal name, courier docket…).
  @IsString() @MinLength(3) @MaxLength(300) recipient!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AcknowledgeDto {
  @IsOptional() @IsDateString() acknowledgedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
