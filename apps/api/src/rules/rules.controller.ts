import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RulesService } from './rules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AcceptRulesDto, AssignRuleSetDto, RecordEventDto } from './dto';

@ApiTags('rules')
@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  // ---- Public endpoints (no authentication) -------------------------------

  @Get('sets')
  listRuleSets() {
    return this.rules.listRuleSets();
  }

  @Get('active')
  getActive(@Query('code') code: string) {
    return this.rules.getActiveVersion(code);
  }

  @Get('versions/:id')
  getVersion(@Param('id') id: string) {
    return this.rules.getVersion(id, true);
  }
}

@ApiTags('rules')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class CaseRulesController {
  constructor(private readonly rules: RulesService) {}

  @Get('cases/:caseId/rules')
  getCaseRules(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.rules.getCaseRules(user, caseId);
  }

  @Post('cases/:caseId/rules/assign')
  assign(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: AssignRuleSetDto) {
    return this.rules.assignToCase(user, caseId, dto);
  }

  @Post('cases/:caseId/rules/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body() dto: AcceptRulesDto,
    @Req() req: Request,
  ) {
    return this.rules.acceptRules(user, caseId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('cases/:caseId/procedural-events')
  listEvents(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.rules.listEvents(user, caseId);
  }

  @Post('cases/:caseId/procedural-events')
  recordEvent(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RecordEventDto) {
    return this.rules.recordEvent(user, caseId, dto);
  }
}
