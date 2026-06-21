import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../providers/email/email.service';
import {
  interpolate,
  Lang,
  NOTIFICATION_TEMPLATES,
  NotificationTemplateKey,
} from './notification-templates';

type Vars = Record<string, string | number | undefined>;

export interface RenderedNotification {
  subject: string;
  body: string;
  type: string;
}

/**
 * Renders bilingual (EN/AR) notification templates and dispatches them over the
 * supported channels: in-platform notification (always), email (optional), and
 * an SMS abstraction (optional, no-op by default).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Render a template in the requested language (falls back to English). */
  render(key: NotificationTemplateKey, lang: Lang, vars: Vars): RenderedNotification {
    const tpl = NOTIFICATION_TEMPLATES[key];
    const text = lang === 'ar' ? tpl.ar : tpl.en;
    return {
      subject: interpolate(text.subject, vars),
      body: interpolate(text.body, vars),
      type: tpl.type,
    };
  }

  /** Resolve a user's preferred language from their profile (default English). */
  private async langForUser(userId: string): Promise<Lang> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { preferredLanguage: true } });
    return profile?.preferredLanguage === 'ar' ? 'ar' : 'en';
  }

  /**
   * Create an in-platform notification for a user, in their preferred language
   * (unless `lang` is given). Returns the persisted row.
   */
  async notify(params: { userId: string; key: NotificationTemplateKey; vars: Vars; lang?: Lang; link?: string }) {
    const lang = params.lang ?? (await this.langForUser(params.userId));
    const rendered = this.render(params.key, lang, params.vars);
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: NOTIFICATION_TEMPLATES[params.key].type,
        title: rendered.subject,
        body: rendered.body,
        link: params.link,
      },
    });
  }

  /** Send a template by email. Render failures/send errors are re-thrown by EmailService. */
  async email_(params: { to: string; key: NotificationTemplateKey; vars: Vars; lang: Lang }) {
    const rendered = this.render(params.key, params.lang, params.vars);
    await this.email.send({ to: params.to, subject: rendered.subject, text: rendered.body });
    return rendered;
  }

  /**
   * Convenience: create the in-platform notification and, when an email address
   * is supplied, also dispatch the email — both in the recipient's language.
   * Email failures are logged but never block the in-platform notification.
   */
  async dispatch(params: { userId: string; to?: string; key: NotificationTemplateKey; vars: Vars; lang?: Lang; link?: string }) {
    const lang = params.lang ?? (await this.langForUser(params.userId));
    const notification = await this.notify({ ...params, lang });
    if (params.to) {
      try {
        await this.email_({ to: params.to, key: params.key, vars: params.vars, lang });
      } catch (err) {
        this.logger.error(`Notification email to ${params.to} failed (in-platform notification was still created): ${(err as Error).message}`);
      }
    }
    return notification;
  }

  /**
   * Optional SMS abstraction. No SMS provider is wired by default; this is the
   * single seam where one would be integrated. It never throws.
   */
  async sendSms(params: { to: string; key: NotificationTemplateKey; vars: Vars; lang: Lang }): Promise<boolean> {
    const rendered = this.render(params.key, params.lang, params.vars);
    this.logger.log(`[sms:noop] → ${params.to}: ${rendered.subject}`);
    return false; // not delivered: no provider configured
  }
}
