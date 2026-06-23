import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@gaap/shared';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  ConflictDisclosureDto,
  DecideChallengeDto,
  DefaultAppointDto,
  InviteArbitratorDto,
  NominateChairDto,
  RaiseChallengeDto,
  RecordVacancyDto,
  ReplaceMemberDto,
  RespondToInvitationDto,
} from './dto';

@ApiTags('appointments')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  // ---- Registrar (institutional) ----
  @Post('cases/:caseId/appointments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  invite(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: InviteArbitratorDto) {
    return this.appointments.invite(user, caseId, dto);
  }

  @Post('cases/:caseId/tribunal/constitute')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  constitute(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.appointments.constitute(user, caseId);
  }

  /** Default (institution) appointment on party silence/refusal or chair-selection failure. */
  @Post('cases/:caseId/appointments/default')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  defaultAppoint(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: DefaultAppointDto) {
    return this.appointments.defaultAppoint(user, caseId, dto);
  }

  @Post('appointments/:id/remind')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  remind(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.sendReminder(user, id);
  }

  /** Expire invitations whose response window has elapsed (also for a scheduled job). */
  @Post('appointments/expire-sweep')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  expireSweep() {
    return this.appointments.expireStaleInvitations();
  }

  /** Co-arbitrators (or the appointing authority) nominate the presiding chair. */
  @Post('cases/:caseId/tribunal/nominate-chair')
  nominateChair(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: NominateChairDto) {
    return this.appointments.nominateChair(user, caseId, dto);
  }

  /** Record a tribunal vacancy (resignation / removal / incapacity / death). */
  @Post('tribunal/members/:memberId/vacancy')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  recordVacancy(@CurrentUser() user: AuthUser, @Param('memberId') memberId: string, @Body() dto: RecordVacancyDto) {
    return this.appointments.recordVacancy(user, memberId, dto);
  }

  /** Invite a replacement arbitrator to fill a vacated seat. */
  @Post('cases/:caseId/tribunal/replace')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.APPOINTMENT_MANAGE)
  replaceMember(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: ReplaceMemberDto) {
    return this.appointments.replaceMember(user, caseId, dto);
  }

  // ---- Arbitrator ----
  @Get('appointments/mine')
  myInvitations(@CurrentUser() user: AuthUser) {
    return this.appointments.myInvitations(user);
  }

  @Post('appointments/:id/conflict-disclosure')
  conflictDisclosure(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConflictDisclosureDto) {
    return this.appointments.submitConflictDisclosure(user, id, dto);
  }

  @Post('appointments/:id/respond')
  respond(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RespondToInvitationDto) {
    return this.appointments.respond(user, id, dto);
  }

  // ---- Arbitrator challenges (Ch8) ----
  @Get('cases/:caseId/challenges')
  listChallenges(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.appointments.listChallenges(user, caseId);
  }

  @Post('cases/:caseId/challenges')
  raiseChallenge(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RaiseChallengeDto) {
    return this.appointments.raiseChallenge(user, caseId, dto);
  }

  @Post('challenges/:id/decide')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.CHALLENGE_DECIDE)
  decideChallenge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideChallengeDto) {
    return this.appointments.decideChallenge(user, id, dto);
  }
}
