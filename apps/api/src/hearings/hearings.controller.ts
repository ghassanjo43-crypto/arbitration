import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HearingsService } from './hearings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AddParticipantDto, ScheduleHearingDto } from './dto';

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

  @Post('hearings/:id/participants')
  addParticipant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddParticipantDto) {
    return this.hearings.addParticipant(user, id, dto);
  }
}
