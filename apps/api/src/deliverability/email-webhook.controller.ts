import { Body, Controller, Headers, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { EmailDeliveryService, ProviderDeliveryEvent } from './email-delivery.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { Permission } from '@gaap/shared';

/** Maps a Resend-style event name to the normalised internal type. */
function normaliseType(raw: string): ProviderDeliveryEvent['type'] | null {
  const t = raw.replace(/^email\./, '');
  const allowed: ProviderDeliveryEvent['type'][] = ['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'opened', 'clicked'];
  return (allowed as string[]).includes(t) ? (t as ProviderDeliveryEvent['type']) : null;
}

interface RawWebhookBody {
  type?: string;
  // Resend nests the message id under data.email_id; accept a few shapes.
  data?: { email_id?: string; message_id?: string; id?: string; reason?: string };
  id?: string;
}

/**
 * Inbound provider delivery webhook. PUBLIC (no JWT) but signature-verified:
 * a request without a valid HMAC signature is rejected with 401. Rate-limited.
 */
@ApiTags('webhooks')
@Controller('webhooks/email')
export class EmailWebhookController {
  constructor(private readonly delivery: EmailDeliveryService) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-webhook-signature') signature: string | undefined, @Body() body: RawWebhookBody) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    if (!this.delivery.verifyWebhook(raw, signature)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    const type = body?.type ? normaliseType(body.type) : null;
    const providerMessageId = body?.data?.email_id ?? body?.data?.message_id ?? body?.data?.id ?? body?.id;
    if (!type || !providerMessageId) {
      return { accepted: false, reason: 'unrecognised event' };
    }
    const res = await this.delivery.handleProviderEvent({ providerMessageId, type, providerEventId: body?.id, detail: body?.data?.reason });
    return { accepted: true, ...res };
  }
}

/** Admin operations: a manual retry sweep of transient failures. */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('admin/email-deliveries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.SUPPORT_MANAGE)
export class EmailDeliveryAdminController {
  constructor(private readonly delivery: EmailDeliveryService) {}

  @Post('retry-sweep')
  retrySweep(@CurrentUser() _user: AuthUser) {
    return this.delivery.retryDue();
  }
}
