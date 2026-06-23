import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { HearingsService } from './hearings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AddParticipantDto, AttendanceDto, ScheduleHearingDto, UpdateHearingDto } from './dto';

@ApiTags('hearings')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class HearingsController {
  constructor(private readonly hearings: HearingsService) {}

  @Get('cases/:caseId/hearings')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.hearings.listForCase(user, caseId);
  }

  @Post('cases/:caseId/hearings')
  schedule(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: ScheduleHearingDto) {
    return this.hearings.schedule(user, caseId, dto);
  }

  @Patch('hearings/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateHearingDto) {
    return this.hearings.update(user, id, dto);
  }

  @Post('hearings/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hearings.cancel(user, id);
  }

  /** Mints a one-time, authorised join link for a single room (audited). */
  @Get('hearings/:id/rooms/:roomId/join')
  join(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('roomId') roomId: string, @Req() req: Request) {
    return this.hearings.getRoomJoinLink(user, id, roomId, req.ip);
  }

  @Post('hearings/:id/participants')
  addParticipant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddParticipantDto) {
    return this.hearings.addParticipant(user, id, dto);
  }

  @Post('hearings/:id/participants/:participantId/attendance')
  attendance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: AttendanceDto,
  ) {
    return this.hearings.recordAttendance(user, id, participantId, dto);
  }
}
