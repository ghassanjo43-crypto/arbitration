import { Global, Module } from '@nestjs/common';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailDeliveryAdminController, EmailWebhookController } from './email-webhook.controller';

/**
 * Global email-deliverability layer: tracked sends, provider webhooks, retry and
 * manual-service fallback. Global so NotificationsService and ServiceService can
 * route their emails through it.
 */
@Global()
@Module({
  providers: [EmailDeliveryService],
  controllers: [EmailWebhookController, EmailDeliveryAdminController],
  exports: [EmailDeliveryService],
})
export class DeliverabilityModule {}
