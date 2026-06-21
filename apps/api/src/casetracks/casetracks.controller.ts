import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExpeditedService } from './expedited.service';
import { MultiPartyService } from './multiparty.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  DecideJoinderDto,
  ExpeditedConsentDto,
  JoinderCommentDto,
  JoinderRequestDto,
  ProposeExpeditedDto,
  TerminateExpeditedDto,
} from './dto';

@ApiTags('expedited')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ExpeditedController {
  constructor(private readonly expedited: ExpeditedService) {}

  @Get('cases/:caseId/expedited')
  get(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.expedited.get(user, caseId);
  }

  @Post('cases/:caseId/expedited')
  propose(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: ProposeExpeditedDto) {
    return this.expedited.propose(user, caseId, dto);
  }

  @Post('cases/:caseId/expedited/consent')
  consent(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: ExpeditedConsentDto) {
    return this.expedited.consent(user, caseId, dto);
  }

  @Post('cases/:caseId/expedited/activate')
  activate(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.expedited.activate(user, caseId);
  }

  @Post('cases/:caseId/expedited/terminate')
  terminate(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: TerminateExpeditedDto) {
    return this.expedited.terminate(user, caseId, dto);
  }
}

@ApiTags('multi-party')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class MultiPartyController {
  constructor(private readonly multiParty: MultiPartyService) {}

  @Get('cases/:caseId/joinder-requests')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.multiParty.listForCase(user, caseId);
  }

  @Post('cases/:caseId/joinder-requests')
  request(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: JoinderRequestDto) {
    return this.multiParty.request(user, caseId, dto);
  }

  @Post('joinder-requests/:id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: JoinderCommentDto) {
    return this.multiParty.comment(user, id, dto);
  }

  @Post('joinder-requests/:id/decide')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideJoinderDto) {
    return this.multiParty.decide(user, id, dto);
  }

  @Post('joinder-requests/:id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.multiParty.withdraw(user, id);
  }
}
