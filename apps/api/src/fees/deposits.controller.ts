import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DepositsService } from './deposits.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { CreateDepositRequestDto, RecordDepositPaymentDto, RefundDto } from './deposits.dto';

// Public fee-schedule endpoints (no auth).
@ApiTags('fees')
@Controller('fee-schedules')
export class FeeSchedulesController {
  constructor(private readonly deposits: DepositsService) {}

  @Get()
  list() {
    return this.deposits.listFeeSchedules();
  }

  @Get('active')
  active(@Query('code') code: string) {
    return this.deposits.getActiveFeeSchedule(code);
  }
}

@ApiTags('deposits')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get('cases/:caseId/deposits')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.deposits.listForCase(user, caseId);
  }

  @Post('cases/:caseId/deposits')
  create(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: CreateDepositRequestDto) {
    return this.deposits.createRequest(user, caseId, dto);
  }

  @Post('deposit-allocations/:id/payments')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RecordDepositPaymentDto) {
    return this.deposits.recordPayment(user, id, dto);
  }

  @Post('deposits/:id/declare-defaults')
  declareDefaults(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deposits.declareDefaults(user, id);
  }

  @Post('deposit-payments/:id/refund')
  refund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RefundDto) {
    return this.deposits.refund(user, id, dto);
  }
}
