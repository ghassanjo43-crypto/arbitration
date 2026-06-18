import { Global, Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { StorageService } from './storage/storage.service';
import { PaymentService } from './payment/payment.service';
import { VideoService } from './video/video.service';

/** Development adapters for all external integrations live behind these interfaces. */
@Global()
@Module({
  providers: [EmailService, StorageService, PaymentService, VideoService],
  exports: [EmailService, StorageService, PaymentService, VideoService],
})
export class ProvidersModule {}
