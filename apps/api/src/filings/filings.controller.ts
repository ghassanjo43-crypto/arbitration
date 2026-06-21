import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FilingsService } from './filings.service';
import { ProductionService } from './production.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import {
  CreateProductionRequestDto,
  DecideCorrectionDto,
  DecideProductionDto,
  NonComplianceDto,
  ObjectProductionDto,
  ProduceDocumentsDto,
  ReplyProductionDto,
  RequestCorrectionDto,
  SubmitFilingDto,
} from './dto';

@ApiTags('filings')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class FilingsController {
  constructor(private readonly filings: FilingsService) {}

  @Get('cases/:caseId/filings')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.filings.listForCase(user, caseId);
  }

  @Post('cases/:caseId/filings')
  submit(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: SubmitFilingDto) {
    return this.filings.submit(user, caseId, dto);
  }

  @Get('filings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.filings.get(user, id);
  }

  @Post('filings/:id/corrections')
  requestCorrection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RequestCorrectionDto) {
    return this.filings.requestCorrection(user, id, dto);
  }

  @Post('filing-corrections/:id/decide')
  decideCorrection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideCorrectionDto) {
    return this.filings.decideCorrection(user, id, dto);
  }
}

@ApiTags('document-production')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('cases/:caseId/production-requests')
  schedule(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.production.listSchedule(user, caseId);
  }

  @Post('cases/:caseId/production-requests')
  create(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: CreateProductionRequestDto) {
    return this.production.createRequest(user, caseId, dto);
  }

  @Post('production-requests/:id/object')
  object(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ObjectProductionDto) {
    return this.production.object(user, id, dto);
  }

  @Post('production-requests/:id/reply')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyProductionDto) {
    return this.production.reply(user, id, dto);
  }

  @Post('production-requests/:id/decide')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideProductionDto) {
    return this.production.decide(user, id, dto);
  }

  @Post('production-requests/:id/produce')
  produce(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ProduceDocumentsDto) {
    return this.production.produce(user, id, dto);
  }

  @Post('production-requests/:id/non-compliance')
  nonCompliance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NonComplianceDto) {
    return this.production.flagNonCompliance(user, id, dto);
  }
}
