import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@gaap/shared';
import { ComplianceService } from './compliance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { ListChecksQuery, ListHoldsQuery, ManualScreenDto, ReleaseHoldDto, ReviewScreeningDto } from './dto';

/**
 * All compliance endpoints require the COMPLIANCE_REVIEW permission — screening
 * results and holds are sensitive and only the compliance/council function may
 * see or act on them.
 */
@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.COMPLIANCE_REVIEW)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('screenings')
  listChecks(@Query() q: ListChecksQuery) {
    return this.compliance.listChecks(q);
  }

  @Get('screenings/:id')
  getCheck(@Param('id') id: string) {
    return this.compliance.getCheck(id);
  }

  /** Manually run a screening (e.g. ad-hoc on a beneficial owner). */
  @Post('screenings')
  screen(@CurrentUser() user: AuthUser, @Body() dto: ManualScreenDto) {
    return this.compliance.screenSubject({ ...dto, requestedById: user.id, triggerEvent: 'MANUAL', force: true });
  }

  /** Record a reviewer's decision on a flagged screening. */
  @Post('screenings/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewScreeningDto) {
    return this.compliance.reviewCheck(user, id, dto.decision, dto.note);
  }

  @Get('holds')
  listHolds(@Query() q: ListHoldsQuery) {
    return this.compliance.listHolds(q);
  }

  @Post('holds/:id/release')
  releaseHold(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReleaseHoldDto) {
    return this.compliance.releaseHold(user, id, dto.note);
  }

  /** Sweep expired screenings (also suitable for a scheduled job). */
  @Post('screenings/expire-sweep')
  expireSweep() {
    return this.compliance.markExpired();
  }
}
