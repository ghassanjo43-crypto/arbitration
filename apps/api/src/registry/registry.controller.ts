import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CaseStage } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { RegistryService } from './registry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';

class TransitionDto {
  @IsEnum(CaseStage)
  toStage!: CaseStage;

  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('registry')
@ApiBearerAuth()
@Controller('registry')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('queue')
  @RequirePermissions(Permission.CASE_VIEW_QUEUE)
  queue() {
    return this.registry.queue();
  }

  @Post('cases/:caseId/transition')
  @RequirePermissions(Permission.CASE_REGISTER)
  transition(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: TransitionDto) {
    return this.registry.transition(user, caseId, dto.toStage, dto.note);
  }
}
