import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DefaultsService } from './defaults.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  DefaultDecisionDto,
  DefaultNoticeDto,
  OpenDefaultDto,
  RegistrarReportDto,
  ReviewFactorDto,
} from './dto';

@ApiTags('default-proceedings')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DefaultsController {
  constructor(private readonly defaults: DefaultsService) {}

  @Get('cases/:caseId/default-proceedings')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.defaults.listForCase(user, caseId);
  }

  @Post('cases/:caseId/default-proceedings')
  open(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: OpenDefaultDto) {
    return this.defaults.open(user, caseId, dto);
  }

  @Get('default-proceedings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.defaults.get(user, id);
  }

  @Post('default-proceedings/:id/notices')
  notice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DefaultNoticeDto) {
    return this.defaults.issueNotice(user, id, dto);
  }

  @Post('default-proceedings/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewFactorDto) {
    return this.defaults.reviewFactor(user, id, dto);
  }

  @Post('default-proceedings/:id/registrar-report')
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RegistrarReportDto) {
    return this.defaults.fileRegistrarReport(user, id, dto);
  }

  @Post('default-proceedings/:id/decide')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DefaultDecisionDto) {
    return this.defaults.decide(user, id, dto);
  }
}
