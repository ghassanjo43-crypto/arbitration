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
import { ExecuteSweepDto, PlaceLegalHoldDto, ReleaseLegalHoldDto } from './dto';

/**
 * Records-retention administration. All endpoints require SETTINGS_MANAGE
 * (super-admin); sweep EXECUTION additionally requires the SUPER_ADMIN role +
 * explicit confirmation (enforced in the service).
 */
@ApiTags('retention')
@ApiBearerAuth()
@Controller('admin/retention')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('policy')
  policy() {
    return this.retention.getPolicy();
  }

  @Get('legal-holds')
  listHolds(@CurrentUser() user: AuthUser, @Query('status') status?: LegalHoldStatus) {
    return this.retention.listLegalHolds(user, status);
  }

  @Post('legal-holds')
  placeHold(@CurrentUser() user: AuthUser, @Body() dto: PlaceLegalHoldDto) {
    return this.retention.placeLegalHold(user, dto);
  }

  @Post('legal-holds/:id/release')
  releaseHold(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReleaseLegalHoldDto) {
    return this.retention.releaseLegalHold(user, id, dto);
  }

  @Get('cases/:caseId/status')
  caseStatus(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.retention.caseRetentionStatus(user, caseId);
  }

  @Get('cases/:caseId/export')
  exportCase(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.retention.exportCaseManifest(user, caseId);
  }

  /** Dry run — reports what would be eligible; changes nothing. */
  @Post('sweep/dry-run')
  dryRun(@CurrentUser() user: AuthUser) {
    return this.retention.dryRunSweep(user);
  }

  /** Execute — super-admin + confirm + opt-in categories; soft-deletes (tombstones). */
  @Post('sweep/execute')
  execute(@CurrentUser() user: AuthUser, @Body() dto: ExecuteSweepDto) {
    return this.retention.executeSweep(user, dto);
  }
}
