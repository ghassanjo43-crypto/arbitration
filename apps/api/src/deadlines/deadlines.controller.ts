import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeadlinesService } from './deadlines.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { CreateDeadlineDto, DeadlineChangeDto, ExtendDeadlineDto, GenerateDeadlineDto } from './dto';

@ApiTags('deadlines')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DeadlinesController {
  constructor(private readonly deadlines: DeadlinesService) {}

  @Get('calendar/mine')
  myCalendar(@CurrentUser() user: AuthUser) {
    return this.deadlines.myCalendar(user);
  }

  @Get('cases/:caseId/deadlines')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.deadlines.listForCase(user, caseId);
  }

  @Post('cases/:caseId/deadlines')
  create(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: CreateDeadlineDto) {
    return this.deadlines.create(user, caseId, dto);
  }

  @Post('cases/:caseId/deadlines/generate')
  generate(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: GenerateDeadlineDto) {
    return this.deadlines.generateFromDefinition(user, caseId, dto);
  }

  @Patch('deadlines/:id/extend')
  extend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExtendDeadlineDto) {
    return this.deadlines.extend(user, id, dto);
  }

  @Patch('deadlines/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deadlines.markComplete(user, id);
  }

  @Patch('deadlines/:id/suspend')
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeadlineChangeDto) {
    return this.deadlines.suspend(user, id, dto);
  }

  @Patch('deadlines/:id/resume')
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeadlineChangeDto) {
    return this.deadlines.resume(user, id, dto);
  }

  @Patch('deadlines/:id/waive')
  waive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeadlineChangeDto) {
    return this.deadlines.waive(user, id, dto);
  }

  @Get('cases/:caseId/deadline-reminders')
  reminders(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.deadlines.listReminders(user, caseId);
  }

  @Post('cases/:caseId/deadlines/escalate-overdue')
  escalate(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.deadlines.escalateOverdue(user, caseId);
  }
}
