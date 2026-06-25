import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LegalHoldStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { RetentionService } from './retention.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { DraftPolicyDto, ExecuteSweepDto, PlaceLegalHoldDto, ReleaseLegalHoldDto, ReviewPolicyDto } from './dto';

/**
 * Records-retention administration & governance.
 *
 * Role model (the guard enforces ALL listed permissions, so OR-combinations are
 * enforced in the service via assertCanView / assertCanReview / assertCanRequestHold):
 *   - Super Admin (SETTINGS_MANAGE): edit/activate policy, place/release holds,
 *     dry-run and EXECUTE sweeps (execution also needs the SUPER_ADMIN role + confirm).
 *   - Council / legal reviewer (POLICY_MANAGE): review/approve policy drafts + read.
 *   - Registrar (CASE_MANAGE_SERVICE): view holds and request a legal hold.
 *   - Arbitrators / parties / lawyers: no access.
 */
@ApiTags('retention')
@ApiBearerAuth()
@Controller('admin/retention')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  // ---- Policy (view + edit workflow) ----
  @Get('policy')
  policy(@CurrentUser() user: AuthUser) {
    return this.retention.viewPolicy(user);
  }

  @Get('policy/draft')
  policyDraft(@CurrentUser() user: AuthUser) {
    return this.retention.getPolicyDraft(user);
  }

  /** Draft a policy change (Super Admin). Optionally submit for review. */
  @Post('policy/draft')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  draftPolicy(@CurrentUser() user: AuthUser, @Body() dto: DraftPolicyDto) {
    return this.retention.draftPolicy(user, dto);
  }

  /** Approve/reject a pending draft (Council / legal reviewer). */
  @Post('policy/review')
  @RequirePermissions(Permission.POLICY_MANAGE)
  reviewPolicy(@CurrentUser() user: AuthUser, @Body() dto: ReviewPolicyDto) {
    return this.retention.reviewPolicy(user, dto);
  }

  /** Activate an approved draft (Super Admin). */
  @Post('policy/activate')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  activatePolicy(@CurrentUser() user: AuthUser) {
    return this.retention.activatePolicy(user);
  }

  // ---- Legal holds ----
  @Get('legal-holds')
  listHolds(@CurrentUser() user: AuthUser, @Query('status') status?: LegalHoldStatus) {
    return this.retention.listLegalHolds(user, status);
  }

  /** Place/request a legal hold (Super Admin or Registrar). A hold only blocks deletion. */
  @Post('legal-holds')
  placeHold(@CurrentUser() user: AuthUser, @Body() dto: PlaceLegalHoldDto) {
    return this.retention.placeLegalHold(user, dto);
  }

  /** Release a legal hold (Super Admin only). */
  @Post('legal-holds/:id/release')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  releaseHold(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReleaseLegalHoldDto) {
    return this.retention.releaseLegalHold(user, id, dto);
  }

  @Get('cases/:caseId/status')
  caseStatus(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.retention.caseRetentionStatus(user, caseId);
  }

  @Get('cases/:caseId/export')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  exportCase(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.retention.exportCaseManifest(user, caseId);
  }

  // ---- Sweep (dry-run + gated execution) ----
  /** Dry run — reports what would be eligible; changes nothing. */
  @Post('sweep/dry-run')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  dryRun(@CurrentUser() user: AuthUser) {
    return this.retention.dryRunSweep(user);
  }

  /** Execute — super-admin + confirm + opt-in categories; soft-deletes (tombstones). */
  @Post('sweep/execute')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  execute(@CurrentUser() user: AuthUser, @Body() dto: ExecuteSweepDto) {
    return this.retention.executeSweep(user, dto);
  }
}
