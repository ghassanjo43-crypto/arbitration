import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@gaap/shared';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { ConflictDisclosureDto, InviteArbitratorDto, RespondToInvitationDto } from './dto';

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
}
