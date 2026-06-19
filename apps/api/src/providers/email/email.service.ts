import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Email provider abstraction.
 *  - `console` (default): logs the message — used for local development, needs no credentials.
 *  - `resend`: real delivery via Resend (set EMAIL_DRIVER=resend, RESEND_API_KEY, EMAIL_FROM).
 *
 * Failures are never swallowed: a send error is logged and re-thrown so the caller
 * (and operators) know an email was not delivered.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;
  private readonly resend?: Resend;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('email.driver') ?? 'console';
    this.from = config.get<string>('email.from') ?? 'Arbitration Panel <onboarding@resend.dev>';

    if (this.driver === 'resend') {
      const apiKey = config.get<string>('email.resendApiKey');
      if (apiKey) {
        this.resend = new Resend(apiKey);
      } else {
        // Surfaced now so it isn't a surprise on the first send attempt.
        this.logger.error('EMAIL_DRIVER=resend but RESEND_API_KEY is not set; email sending will fail.');
      }
    }
  }

  async send(message: EmailMessage): Promise<void> {
    switch (this.driver) {
      case 'console':
        this.logger.log(
          `[EMAIL:console] from=${this.from} to=${message.to} subject="${message.subject}"\n${message.text}`,
        );
        return;

      case 'resend':
        return this.sendViaResend(message);

      default:
        // Unknown/unimplemented driver: do NOT silently drop — make it loud.
        throw new Error(`Email driver "${this.driver}" is not implemented; cannot deliver email.`);
    }
  }

  private async sendViaResend(message: EmailMessage): Promise<void> {
    if (!this.resend) {
      throw new Error('Resend is not configured: set RESEND_API_KEY to enable email delivery.');
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
        this.logger.error(`Resend failed to send to=${message.to} subject="${message.subject}": ${error.message}`);
        throw new Error(`Email delivery failed: ${error.message}`);
      }

      this.logger.log(`[EMAIL:resend] sent to=${message.to} subject="${message.subject}" id=${data?.id ?? 'unknown'}`);
    } catch (err) {
      // Network/SDK exceptions: log with detail and re-throw so the email is never lost silently.
      if (err instanceof Error && err.message.startsWith('Email delivery failed')) throw err;
      this.logger.error(`Resend threw while sending to=${message.to}: ${(err as Error).message}`, err as Error);
      throw new Error(`Email delivery failed for ${message.to}: ${(err as Error).message}`);
    }
  }
}
