import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role, UserStatus } from '@gaap/shared';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() displayName?: string;
  /** Optional initial roles. Assigning staff roles requires ROLE_MANAGE (enforced in service). */
  @IsOptional() @IsArray() @IsEnum(Role, { each: true }) roles?: Role[];
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsBoolean() emailVerified?: boolean;
  /** If omitted, a temporary password is generated and returned once to the admin. */
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsBoolean() emailVerified?: boolean;
}

export class SetRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

export class ResetPasswordDto {
  /** When true, e-mail the user a self-service reset link instead of setting a password. */
  @IsOptional() @IsBoolean() sendEmail?: boolean;
  /** Explicit new password; if omitted (and not sendEmail) a temporary one is generated. */
  @IsOptional() @IsString() @MinLength(8) newPassword?: string;
}
