import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role, UserStatus } from '@gaap/shared';

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

export class SetRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}
