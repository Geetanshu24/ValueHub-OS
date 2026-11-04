import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword!: string;
}
