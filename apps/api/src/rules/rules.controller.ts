import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permission } from '@gaap/shared';
import { RulesService } from './rules.service';
import { RuleReviewService } from './rule-review.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  AcceptRulesDto, AssignRuleSetDto, CreateDraftVersionDto, RecordEventDto, RecordExceptionDto,
  RecordOverrideDto, RecordReviewDto, UpdateRuleTextDto,
} from './dto';

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

  @Get('cases/:caseId/rule-executions')
  listExecutions(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.rules.listExecutions(user, caseId);
  }

  @Post('cases/:caseId/rule-overrides')
  recordOverride(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RecordOverrideDto) {
    return this.rules.recordOverride(user, caseId, dto);
  }

  @Post('cases/:caseId/rule-exceptions')
  recordException(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RecordExceptionDto) {
    return this.rules.recordException(user, caseId, dto);
  }
}

/**
 * Counsel-review / authoring administration. All endpoints require POLICY_MANAGE
 * (the council/policy function). The platform records counsel's decisions and
 * gates activation; it does not itself perform the legal review.
 */
@ApiTags('rules-admin')
@ApiBearerAuth()
@Controller('rules/admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.POLICY_MANAGE)
export class RuleReviewController {
  constructor(private readonly review: RuleReviewService) {}

  @Get('versions')
  listVersions(@CurrentUser() user: AuthUser) {
    return this.review.listVersions(user);
  }

  @Get('versions/:id')
  getVersion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.review.getVersionForReview(user, id);
  }

  @Post('versions')
  createDraft(@CurrentUser() user: AuthUser, @Body() dto: CreateDraftVersionDto) {
    return this.review.createDraftVersion(user, dto);
  }

  @Get('diff')
  diff(@CurrentUser() user: AuthUser, @Query('base') base: string, @Query('target') target: string) {
    return this.review.diff(user, base, target);
  }

  @Patch('rules/:ruleId')
  editRule(@CurrentUser() user: AuthUser, @Param('ruleId') ruleId: string, @Body() dto: UpdateRuleTextDto) {
    return this.review.updateRuleText(user, ruleId, dto);
  }

  @Post('versions/:versionId/rules/:ruleId/review')
  recordReview(@CurrentUser() user: AuthUser, @Param('versionId') versionId: string, @Param('ruleId') ruleId: string, @Body() dto: RecordReviewDto) {
    return this.review.recordReview(user, versionId, ruleId, dto);
  }

  @Post('versions/:id/activate')
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.review.activateVersion(user, id);
  }
}
