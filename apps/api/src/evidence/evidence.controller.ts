import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EvidenceService } from './evidence.service';
import { ExpertsService } from './experts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  AddExpertDto,
  AddWitnessDto,
  DeclareIndependenceDto,
  ExpertReportDto,
  RaiseObjectionDto,
  RecordOathDto,
  RuleObjectionDto,
  WitnessStatementDto,
} from './dto';

@ApiTags('evidence')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly experts: ExpertsService,
  ) {}

  // ---- Witnesses ----------------------------------------------------------

  @Get('cases/:caseId/witnesses')
  listWitnesses(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.evidence.listWitnesses(user, caseId);
  }

  @Post('cases/:caseId/witnesses')
  addWitness(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: AddWitnessDto) {
    return this.evidence.addWitness(user, caseId, dto);
  }

  @Post('witnesses/:id/statements')
  statement(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WitnessStatementDto) {
    return this.evidence.submitStatement(user, id, dto);
  }

  @Post('witnesses/:id/verify-identity')
  verify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.evidence.verifyIdentity(user, id);
  }

  @Post('witnesses/:id/acknowledge-isolation')
  isolation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.evidence.acknowledgeIsolation(user, id);
  }

  @Post('witnesses/:id/oath')
  oath(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RecordOathDto) {
    return this.evidence.recordOath(user, id, dto);
  }

  // ---- Experts ------------------------------------------------------------

  @Get('cases/:caseId/experts')
  listExperts(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.experts.listForCase(user, caseId);
  }

  @Post('cases/:caseId/experts')
  addExpert(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: AddExpertDto) {
    return this.experts.addExpert(user, caseId, dto);
  }

  @Post('experts/:id/independence')
  independence(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeclareIndependenceDto) {
    return this.experts.declareIndependence(user, id, dto);
  }

  @Post('experts/:id/reports')
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExpertReportDto) {
    return this.experts.submitReport(user, id, dto);
  }

  // ---- Evidence objections ------------------------------------------------

  @Get('cases/:caseId/evidence-objections')
  listObjections(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.evidence.listObjections(user, caseId);
  }

  @Post('cases/:caseId/evidence-objections')
  raise(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RaiseObjectionDto) {
    return this.evidence.raiseObjection(user, caseId, dto);
  }

  @Post('evidence-objections/:id/rule')
  rule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RuleObjectionDto) {
    return this.evidence.ruleObjection(user, id, dto);
  }
}
