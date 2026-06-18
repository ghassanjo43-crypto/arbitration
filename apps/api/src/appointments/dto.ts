import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TribunalRole, PartySide } from '@prisma/client';

export class InviteArbitratorDto {
  @IsUUID()
  arbitratorId!: string;

  @IsEnum(TribunalRole)
  proposedRole!: TribunalRole;

  @IsOptional()
  @IsEnum(PartySide)
  nominatedBy?: PartySide;
}

export class ConflictDisclosureDto {
  @IsBoolean()
  hasConflict!: boolean;

  @IsOptional()
  @IsString()
  disclosureText?: string;

  @IsBoolean()
  independenceDeclared!: boolean;

  @IsBoolean()
  impartialityDeclared!: boolean;
}

export class RespondToInvitationDto {
  @IsBoolean()
  accept!: boolean;

  @IsBoolean()
  feeAccepted!: boolean;

  @IsBoolean()
  availabilityConfirmed!: boolean;
}
