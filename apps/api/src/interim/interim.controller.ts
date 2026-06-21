import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InterimService } from './interim.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { ApplyInterimDto, DecideInterimDto, InterimDetailDto } from './dto';

@ApiTags('interim-measures')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class InterimController {
  constructor(private readonly interim: InterimService) {}

  @Get('cases/:caseId/interim-measures')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.interim.listForCase(user, caseId);
  }

  @Post('cases/:caseId/interim-measures')
  apply(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: ApplyInterimDto) {
    return this.interim.apply(user, caseId, dto);
  }

  @Get('interim-measures/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.interim.get(user, id);
  }

  @Post('interim-measures/:id/notice')
  notice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InterimDetailDto) {
    return this.interim.issueNotice(user, id, dto);
  }

  @Post('interim-measures/:id/oppose')
  oppose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InterimDetailDto) {
    return this.interim.oppose(user, id, dto);
  }

  @Post('interim-measures/:id/decide')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideInterimDto) {
    return this.interim.decide(user, id, dto);
  }

  @Post('interim-measures/:id/modify')
  modify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InterimDetailDto) {
    return this.interim.modify(user, id, dto);
  }

  @Post('interim-measures/:id/discharge')
  discharge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InterimDetailDto) {
    return this.interim.discharge(user, id, dto);
  }

  @Post('interim-measures/:id/compliance')
  compliance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InterimDetailDto) {
    return this.interim.recordCompliance(user, id, dto);
  }
}
