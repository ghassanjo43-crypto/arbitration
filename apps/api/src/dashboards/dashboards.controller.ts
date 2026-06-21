import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardsService } from './dashboards.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller('dashboards')
@UseGuards(JwtAuthGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('registrar')
  registrar(@CurrentUser() user: AuthUser) {
    return this.dashboards.registrar(user);
  }

  @Get('arbitrator')
  arbitrator(@CurrentUser() user: AuthUser) {
    return this.dashboards.arbitrator(user);
  }

  @Get('finance')
  finance(@CurrentUser() user: AuthUser) {
    return this.dashboards.finance(user);
  }
}
