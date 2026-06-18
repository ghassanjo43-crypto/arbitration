import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@gaap/shared';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AllocateDto, CreateInvoiceDto, RecordPaymentDto } from './dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('cases/:caseId/finance')
  finance(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.payments.caseFinance(user, caseId);
  }

  @Post('cases/:caseId/invoices')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.INVOICE_MANAGE)
  createInvoice(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: CreateInvoiceDto) {
    return this.payments.createInvoice(user, caseId, dto);
  }

  @Post('invoices/:id/allocations')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.INVOICE_MANAGE)
  allocate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AllocateDto) {
    return this.payments.allocate(user, id, dto);
  }

  @Post('cases/:caseId/payments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.PAYMENT_RECORD)
  recordPayment(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: RecordPaymentDto) {
    return this.payments.recordPayment(user, caseId, dto);
  }
}
