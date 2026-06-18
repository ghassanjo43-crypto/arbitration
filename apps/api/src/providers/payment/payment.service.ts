import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface PaymentIntentResult {
  providerRef: string;
  status: 'PENDING' | 'SUCCEEDED';
  clientSecret?: string;
}

/**
 * Payment provider abstraction. The "manual" development adapter records an
 * intent that a registrar later confirms (mirroring bank-transfer deposits
 * common in arbitration). Swap PAYMENT_DRIVER=stripe to integrate a gateway.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly driver: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('payment.driver') ?? 'manual';
  }

  async createIntent(amount: number, currency: string): Promise<PaymentIntentResult> {
    if (this.driver === 'manual') {
      this.logger.log(`[PAYMENT:manual] intent ${amount} ${currency} (awaiting registrar confirmation)`);
      return { providerRef: `manual_${randomUUID()}`, status: 'PENDING' };
    }
    this.logger.warn(`Payment driver "${this.driver}" not implemented.`);
    return { providerRef: `unimpl_${randomUUID()}`, status: 'PENDING' };
  }
}
