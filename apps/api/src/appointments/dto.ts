import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TribunalRole, PartySide, ChallengeStatus, AppointmentMethod, VacancyReason } from '@prisma/client';

export class InviteArbitratorDto {
  @IsUUID()
  arbitratorId!: string;

  @IsEnum(TribunalRole)
  proposedRole!: TribunalRole;

  @IsOptional()
  @IsEnum(PartySide)
  nominatedBy?: PartySide;

  @IsOptional()
  @IsEnum(AppointmentMethod)
  appointmentMethod?: AppointmentMethod;
}

export class DefaultAppointDto {
  @IsUUID()
  arbitratorId!: string;

  @IsEnum(TribunalRole)
  proposedRole!: TribunalRole;

  @IsOptional()
  @IsEnum(PartySide)
  nominatedBy?: PartySide;

  /** Why the default appointment was made (party silence/refusal, chair failure). */
  @IsOptional()
  @IsString()
  reason?: string;
}

export class NominateChairDto {
  @IsUUID()
  arbitratorId!: string;
}

export class RecordVacancyDto {
  @IsEnum(VacancyReason)
  reason!: VacancyReason;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ReplaceMemberDto {
  /** userId of the member being replaced. */
  @IsString()
  vacatedUserId!: string;

  @IsUUID()
  arbitratorId!: string;

  @IsEnum(TribunalRole)
  proposedRole!: TribunalRole;

  @IsOptional()
  @IsEnum(PartySide)
  nominatedBy?: PartySide;

  @IsOptional()
  @IsEnum(AppointmentMethod)
  appointmentMethod?: AppointmentMethod;
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

  @IsOptional()
  @IsString()
  declineReason?: string;
}

export class RaiseChallengeDto {
  @IsString()
  challengedArbitratorUserId!: string;

  @IsString()
  grounds!: string;
}

export class DecideChallengeDto {
  @IsEnum(ChallengeStatus)
  status!: ChallengeStatus; // UPHELD | DISMISSED

  @IsOptional()
  @IsString()
  decisionNote?: string;
}
