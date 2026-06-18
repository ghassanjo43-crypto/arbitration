import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AwardsService } from './awards.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { CorrectionRequestDto, CreateAwardDto, SignAwardDto } from './dto';

@ApiTags('awards')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class AwardsController {
  constructor(private readonly awards: AwardsService) {}

  @Get('cases/:caseId/awards')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.awards.listForCase(user, caseId);
  }

  @Post('cases/:caseId/awards')
  create(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: CreateAwardDto) {
    return this.awards.create(user, caseId, dto);
  }

  @Post('awards/:id/sign')
  sign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SignAwardDto) {
    return this.awards.sign(user, id, dto);
  }

  @Post('awards/:id/issue')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.awards.issue(user, id);
  }

  @Post('awards/:id/corrections')
  requestCorrection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CorrectionRequestDto) {
    return this.awards.requestCorrection(user, id, dto);
  }
}
