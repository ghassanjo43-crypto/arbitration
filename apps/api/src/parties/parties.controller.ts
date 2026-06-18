import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartiesService } from './parties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AddRepresentativeDto, AddTeamMemberDto, UpsertPartyDto } from './dto';

@ApiTags('parties')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Post('cases/:caseId/parties')
  addParty(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: UpsertPartyDto) {
    return this.parties.addParty(user, caseId, dto);
  }

  @Patch('parties/:id')
  updateParty(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpsertPartyDto) {
    return this.parties.updateParty(user, id, dto);
  }

  @Post('parties/:id/representatives')
  addRepresentative(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddRepresentativeDto) {
    return this.parties.addRepresentative(user, id, dto);
  }

  @Get('cases/:caseId/team')
  listTeam(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.parties.listTeam(user, caseId);
  }

  @Post('cases/:caseId/team')
  addTeamMember(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: AddTeamMemberDto) {
    return this.parties.addTeamMember(user, caseId, dto);
  }
}
