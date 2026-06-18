import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Email provider abstraction. Development uses the console adapter (logs the
 * message). Swap EMAIL_DRIVER=smtp and implement the SMTP path for production.
 * No real provider credentials are required to run locally.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('email.driver') ?? 'console';
    this.from = config.get<string>('email.from') ?? 'no-reply@arbitration.example';
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.driver === 'console') {
      this.logger.log(
        `[EMAIL:console] from=${this.from} to=${message.to} subject="${message.subject}"\n${message.text}`,
      );
      return;
    }
    // SMTP/other adapters integrate here behind the same interface.
    this.logger.warn(`Email driver "${this.driver}" not implemented; message dropped.`);
  }
}
