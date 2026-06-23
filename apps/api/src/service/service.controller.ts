import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ServiceService } from './service.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AcknowledgeNoticeDto, IssueNoticeDto, SubstituteServiceDto } from './dto';

@ApiTags('service')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

  @Get('cases/:caseId/notices')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.service.listForCase(user, caseId);
  }

  @Get('cases/:caseId/notice-requirements')
  noticeRequirements(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.service.listNoticeRequirements(user, caseId);
  }

  /** Email-delivery evidence for the case (registry/tribunal only). */
  @Get('cases/:caseId/email-deliveries')
  emailDeliveries(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.service.listEmailDeliveries(user, caseId);
  }

  @Post('cases/:caseId/notices')
  issue(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body() dto: IssueNoticeDto,
    @Req() req: Request,
  ) {
    return this.service.issueNotice(user, caseId, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('notices/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getNotice(user, id);
  }

  @Post('notices/:id/access')
  access(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('action') action: 'OPENED' | 'DOWNLOADED' = 'OPENED',
    @Req() req: Request,
  ) {
    return this.service.recordAccess(user, id, action === 'DOWNLOADED' ? 'DOWNLOADED' : 'OPENED', {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('notices/:id/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AcknowledgeNoticeDto,
    @Req() req: Request,
  ) {
    return this.service.acknowledge(user, id, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('notices/:id/substitute-service')
  substitute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubstituteServiceDto) {
    return this.service.orderSubstituteService(user, id, dto);
  }

  @Post('notices/:id/certificate')
  certificate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.generateCertificate(user, id);
  }

  /** Download the generated Certificate of Electronic Service as a PDF. */
  @Get('notices/:id/certificate/document')
  async certificateDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, fileName } = await this.service.downloadCertificate(user, id, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  }
}
