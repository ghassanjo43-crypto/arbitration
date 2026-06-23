import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  /** Provider message id — used to link delivery webhook events back. */
  providerMessageId: string;
  provider: string;
}

/** A failed send, classified so the caller can decide whether to retry. */
export class EmailSendError extends Error {
  constructor(message: string, readonly kind: 'TEMPORARY' | 'PERMANENT', readonly provider: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Heuristic: which provider/SDK errors are permanent (never silently retried). */
function classifyFailure(message: string): 'TEMPORARY' | 'PERMANENT' {
  const m = message.toLowerCase();
  if (/invalid|not a valid|no recipients|recipient.*reject|does not exist|unknown user|mailbox.*not|blocked|unsubscrib/.test(m)) {
    return 'PERMANENT';
  }
  return 'TEMPORARY';
}

/**
 * Email provider abstraction.
 *  - `console` (default): logs the message and returns a synthetic message id —
 *    used for local development, needs no credentials.
 *  - `resend`: real delivery via Resend (EMAIL_DRIVER=resend, RESEND_API_KEY,
 *    EMAIL_FROM — set EMAIL_FROM to a verified-domain sender in production).
 *
 * send() returns the provider message id so the deliverability layer can link
 * provider delivery webhooks back to the platform record. Failures are never
 * swallowed: they are classified TEMPORARY/PERMANENT and thrown as EmailSendError.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;
  private readonly webhookSecret: string;
  private readonly resend?: Resend;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('email.driver') ?? 'console';
    this.from = config.get<string>('email.from') ?? 'Arbitration Panel <onboarding@resend.dev>';
    this.webhookSecret = config.get<string>('email.webhookSecret') ?? 'dev-email-webhook-secret';

    if (this.driver === 'resend') {
      const apiKey = config.get<string>('email.resendApiKey');
      if (apiKey) {
        this.resend = new Resend(apiKey);
      } else {
        this.logger.error('EMAIL_DRIVER=resend but RESEND_API_KEY is not set; email sending will fail.');
      }
    }
  }

  get providerName(): string {
    return this.driver;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    switch (this.driver) {
      case 'console': {
        const providerMessageId = `console_${randomUUID()}`;
        this.logger.log(
          `[EMAIL:console] from=${this.from} to=${message.to} subject="${message.subject}" id=${providerMessageId}\n${message.text}`,
        );
        return { providerMessageId, provider: 'console' };
      }
      case 'resend':
        return this.sendViaResend(message);
      default:
        throw new EmailSendError(`Email driver "${this.driver}" is not implemented; cannot deliver email.`, 'PERMANENT', this.driver);
    }
  }

  private async sendViaResend(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.resend) {
      throw new EmailSendError('Resend is not configured: set RESEND_API_KEY to enable email delivery.', 'TEMPORARY', 'resend');
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      if (error) {
        const kind = classifyFailure(error.message);
        this.logger.error(`Resend failed to send to=${message.to} subject="${message.subject}" (${kind}): ${error.message}`);
        throw new EmailSendError(`Email delivery failed: ${error.message}`, kind, 'resend');
      }
      this.logger.log(`[EMAIL:resend] sent to=${message.to} subject="${message.subject}" id=${data?.id ?? 'unknown'}`);
      return { providerMessageId: data?.id ?? `resend_${randomUUID()}`, provider: 'resend' };
    } catch (err) {
      if (err instanceof EmailSendError) throw err;
      // Network/SDK exceptions are transient by default.
      const msg = (err as Error).message;
      this.logger.error(`Resend threw while sending to=${message.to}: ${msg}`);
      throw new EmailSendError(`Email delivery failed for ${message.to}: ${msg}`, 'TEMPORARY', 'resend');
    }
  }

  /**
   * Verify a provider webhook's signature: HMAC-SHA256 of the raw request body
   * with EMAIL_WEBHOOK_SECRET, compared in constant time. (For Resend/Svix in
   * production, adapt this to the Svix signature scheme.)
   */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
