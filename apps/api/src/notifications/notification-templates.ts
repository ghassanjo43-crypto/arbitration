import { NotificationType } from '@prisma/client';

/** Stable keys for every notifiable procedural event (spec Chapter: Notifications). */
export type NotificationTemplateKey =
  | 'FILING_SUBMITTED'
  | 'DEFICIENCY_NOTICE'
  | 'CASE_REGISTERED'
  | 'NOTICE_ISSUED'
  | 'RESPONSE_DUE'
  | 'DEADLINE_REMINDER'
  | 'DEADLINE_OVERDUE'
  | 'APPOINTMENT_INVITATION'
  | 'APPOINTMENT_REMINDER'
  | 'DEFAULT_APPOINTMENT'
  | 'CHAIR_NOMINATION'
  | 'TRIBUNAL_VACANCY'
  | 'ARBITRATOR_REPLACEMENT'
  | 'CONFLICT_DISCLOSURE'
  | 'CHALLENGE'
  | 'CHALLENGE_DECIDED'
  | 'TRIBUNAL_CONSTITUTED'
  | 'PROCEDURAL_CONFERENCE'
  | 'FILING_RECEIVED'
  | 'HEARING_SCHEDULED'
  | 'PAYMENT_REQUESTED'
  | 'PAYMENT_OVERDUE'
  | 'SUBSTITUTE_PAYMENT_OPPORTUNITY'
  | 'ORDER_ISSUED'
  | 'AWARD_ISSUED'
  | 'CORRECTION_DEADLINE';

export type Lang = 'en' | 'ar';

interface LocalisedText {
  subject: string;
  body: string;
}

export interface NotificationTemplate {
  /** In-platform Notification.type bucket. */
  type: NotificationType;
  en: LocalisedText;
  ar: LocalisedText;
}

/**
 * Bilingual (EN/AR) template catalog. Placeholders use `{{name}}` and are filled
 * from the caller-supplied variables. Text is platform-neutral and must be
 * reviewed by qualified arbitration counsel before production launch.
 */
export const NOTIFICATION_TEMPLATES: Record<NotificationTemplateKey, NotificationTemplate> = {
  FILING_SUBMITTED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Filing submitted — {{caseRef}}', body: 'Your {{filingType}} for case {{caseRef}} has been submitted. Filing number {{filingNumber}}.' },
    ar: { subject: 'تم تقديم الإيداع — {{caseRef}}', body: 'تم تقديم {{filingType}} في القضية {{caseRef}}. رقم الإيداع {{filingNumber}}.' },
  },
  DEFICIENCY_NOTICE: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Deficiency notice — {{caseRef}}', body: 'A deficiency was identified in your filing for case {{caseRef}}. Please correct it by {{dueDate}}.' },
    ar: { subject: 'إشعار نقص — {{caseRef}}', body: 'تبيّن وجود نقص في إيداعك في القضية {{caseRef}}. يُرجى تصحيحه قبل {{dueDate}}.' },
  },
  CASE_REGISTERED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Case registered — {{caseRef}}', body: 'Case {{caseRef}} has been registered. The arbitration is now administered under the applicable rules.' },
    ar: { subject: 'تم تسجيل القضية — {{caseRef}}', body: 'تم تسجيل القضية {{caseRef}}. تُدار إجراءات التحكيم الآن وفق القواعد المعمول بها.' },
  },
  NOTICE_ISSUED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Notice issued — {{caseRef}}', body: 'A formal notice ({{noticeType}}) has been issued in case {{caseRef}}. Log in to access and acknowledge it.' },
    ar: { subject: 'تم إصدار إخطار — {{caseRef}}', body: 'صدر إخطار رسمي ({{noticeType}}) في القضية {{caseRef}}. سجّل الدخول للاطلاع عليه والإقرار باستلامه.' },
  },
  RESPONSE_DUE: {
    type: NotificationType.DEADLINE,
    en: { subject: 'Response due — {{caseRef}}', body: 'Your response in case {{caseRef}} is due on {{dueDate}} ({{timezone}}).' },
    ar: { subject: 'موعد الرد — {{caseRef}}', body: 'يستحق ردك في القضية {{caseRef}} بتاريخ {{dueDate}} ({{timezone}}).' },
  },
  DEADLINE_REMINDER: {
    type: NotificationType.DEADLINE,
    en: { subject: 'Reminder: {{title}} due {{dueDate}}', body: 'Reminder — "{{title}}" in case {{caseRef}} is due on {{dueDate}} ({{timezone}}).' },
    ar: { subject: 'تذكير: {{title}} يستحق في {{dueDate}}', body: 'تذكير — يستحق "{{title}}" في القضية {{caseRef}} بتاريخ {{dueDate}} ({{timezone}}).' },
  },
  DEADLINE_OVERDUE: {
    type: NotificationType.DEADLINE,
    en: { subject: 'Overdue: {{title}} — {{caseRef}}', body: 'The deadline "{{title}}" in case {{caseRef}} passed on {{dueDate}} and is now overdue. The registry has been notified.' },
    ar: { subject: 'متأخر: {{title}} — {{caseRef}}', body: 'انقضى الموعد النهائي "{{title}}" في القضية {{caseRef}} بتاريخ {{dueDate}} وأصبح متأخراً. وقد أُبلغ القلم بذلك.' },
  },
  APPOINTMENT_INVITATION: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Appointment invitation — {{caseRef}}', body: 'You are invited to serve as {{role}} in case {{caseRef}}. Please complete your conflict disclosure and respond.' },
    ar: { subject: 'دعوة تعيين — {{caseRef}}', body: 'تتلقى دعوة للعمل بصفة {{role}} في القضية {{caseRef}}. يُرجى استكمال إفصاح تضارب المصالح والرد.' },
  },
  APPOINTMENT_REMINDER: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Reminder: appointment response due — {{caseRef}}', body: 'A response to your appointment invitation in case {{caseRef}} is still outstanding. Please complete your conflict disclosure and respond by {{dueDate}}.' },
    ar: { subject: 'تذكير: يلزم الرد على التعيين — {{caseRef}}', body: 'لا يزال الرد على دعوة تعيينك في القضية {{caseRef}} معلّقاً. يُرجى استكمال إفصاح تضارب المصالح والرد قبل {{dueDate}}.' },
  },
  DEFAULT_APPOINTMENT: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Default appointment made — {{caseRef}}', body: 'As the applicable time limit elapsed, the appointing authority has made a default appointment to the tribunal in case {{caseRef}}.' },
    ar: { subject: 'تعيين بديل تلقائي — {{caseRef}}', body: 'نظراً لانقضاء المهلة المقررة، أجرت سلطة التعيين تعييناً تلقائياً في هيئة التحكيم في القضية {{caseRef}}.' },
  },
  CHAIR_NOMINATION: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Presiding arbitrator nomination — {{caseRef}}', body: 'A presiding arbitrator (chair) has been nominated in case {{caseRef}} and invited to accept.' },
    ar: { subject: 'ترشيح رئيس الهيئة — {{caseRef}}', body: 'تم ترشيح رئيس لهيئة التحكيم في القضية {{caseRef}} ودعوته للقبول.' },
  },
  TRIBUNAL_VACANCY: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Tribunal vacancy — {{caseRef}}', body: 'A vacancy has arisen on the tribunal in case {{caseRef}} ({{reason}}). A replacement will be appointed under the applicable rules.' },
    ar: { subject: 'شغور في الهيئة — {{caseRef}}', body: 'نشأ شغور في هيئة التحكيم في القضية {{caseRef}} ({{reason}}). وسيُعيَّن بديل وفق القواعد المعمول بها.' },
  },
  ARBITRATOR_REPLACEMENT: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Replacement arbitrator — {{caseRef}}', body: 'A replacement arbitrator has been invited to fill the vacancy on the tribunal in case {{caseRef}}.' },
    ar: { subject: 'محكّم بديل — {{caseRef}}', body: 'تمت دعوة محكّم بديل لملء الشغور في هيئة التحكيم في القضية {{caseRef}}.' },
  },
  CONFLICT_DISCLOSURE: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Conflict disclosure — {{caseRef}}', body: 'A conflict disclosure has been filed in case {{caseRef}}. You may submit comments within the applicable period.' },
    ar: { subject: 'إفصاح تضارب مصالح — {{caseRef}}', body: 'تم تقديم إفصاح تضارب مصالح في القضية {{caseRef}}. يمكنك تقديم ملاحظاتك خلال المدة المقررة.' },
  },
  CHALLENGE: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Arbitrator challenge — {{caseRef}}', body: 'A challenge to an arbitrator has been raised in case {{caseRef}}. The authorised authority will decide it.' },
    ar: { subject: 'طلب رد محكّم — {{caseRef}}', body: 'تم تقديم طلب رد محكّم في القضية {{caseRef}}. ستبتّ فيه الجهة المختصة.' },
  },
  CHALLENGE_DECIDED: {
    type: NotificationType.APPOINTMENT,
    en: { subject: 'Challenge decided — {{caseRef}}', body: 'The challenge to an arbitrator in case {{caseRef}} has been {{outcome}}. The appointment workflow will continue accordingly.' },
    ar: { subject: 'صدر القرار في طلب الرد — {{caseRef}}', body: 'تم البتّ في طلب رد المحكّم في القضية {{caseRef}}: {{outcome}}. وستستمر إجراءات التعيين وفقاً لذلك.' },
  },
  TRIBUNAL_CONSTITUTED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Tribunal constituted — {{caseRef}}', body: 'The arbitral tribunal in case {{caseRef}} has been constituted. Proceedings will continue under the procedural timetable.' },
    ar: { subject: 'تشكّلت هيئة التحكيم — {{caseRef}}', body: 'تشكّلت هيئة التحكيم في القضية {{caseRef}}. وستستمر الإجراءات وفق الجدول الزمني الإجرائي.' },
  },
  PROCEDURAL_CONFERENCE: {
    type: NotificationType.HEARING,
    en: { subject: 'Procedural conference — {{caseRef}}', body: 'A preliminary procedural conference in case {{caseRef}} is scheduled for {{dateTime}} ({{timezone}}).' },
    ar: { subject: 'جلسة إجرائية تمهيدية — {{caseRef}}', body: 'حُددت جلسة إجرائية تمهيدية في القضية {{caseRef}} بتاريخ {{dateTime}} ({{timezone}}).' },
  },
  FILING_RECEIVED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Filing received — {{caseRef}}', body: 'A {{filingType}} has been received in case {{caseRef}}. You may review it in the case workspace.' },
    ar: { subject: 'تم استلام إيداع — {{caseRef}}', body: 'تم استلام {{filingType}} في القضية {{caseRef}}. يمكنك مراجعته في مساحة عمل القضية.' },
  },
  HEARING_SCHEDULED: {
    type: NotificationType.HEARING,
    en: { subject: 'Hearing scheduled — {{caseRef}}', body: 'A hearing in case {{caseRef}} is scheduled for {{dateTime}} ({{timezone}}). Please complete the technical test session in advance.' },
    ar: { subject: 'تم تحديد جلسة — {{caseRef}}', body: 'حُددت جلسة في القضية {{caseRef}} بتاريخ {{dateTime}} ({{timezone}}). يُرجى إجراء اختبار تقني مسبق.' },
  },
  PAYMENT_REQUESTED: {
    type: NotificationType.PAYMENT,
    en: { subject: 'Payment requested — {{caseRef}}', body: 'A payment of {{amount}} {{currency}} is requested in case {{caseRef}}, due by {{dueDate}}.' },
    ar: { subject: 'طلب سداد — {{caseRef}}', body: 'مطلوب سداد {{amount}} {{currency}} في القضية {{caseRef}}، ويستحق بحلول {{dueDate}}.' },
  },
  PAYMENT_OVERDUE: {
    type: NotificationType.PAYMENT,
    en: { subject: 'Payment overdue — {{caseRef}}', body: 'A payment of {{amount}} {{currency}} in case {{caseRef}} is overdue. Consequences are subject to the tribunal and applicable law.' },
    ar: { subject: 'سداد متأخر — {{caseRef}}', body: 'تأخّر سداد {{amount}} {{currency}} في القضية {{caseRef}}. وتخضع النتائج لقرار الهيئة والقانون المعمول به.' },
  },
  SUBSTITUTE_PAYMENT_OPPORTUNITY: {
    type: NotificationType.PAYMENT,
    en: { subject: 'Substitute payment opportunity — {{caseRef}}', body: 'An unpaid share remains in case {{caseRef}}. You may pay it by substitution without admission or waiver.' },
    ar: { subject: 'فرصة سداد بديل — {{caseRef}}', body: 'ما زالت هناك حصة غير مسددة في القضية {{caseRef}}. يمكنك سدادها بالنيابة دون إقرار أو تنازل.' },
  },
  ORDER_ISSUED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Procedural order issued — {{caseRef}}', body: 'The tribunal has issued {{orderTitle}} in case {{caseRef}}.' },
    ar: { subject: 'صدور أمر إجرائي — {{caseRef}}', body: 'أصدرت الهيئة {{orderTitle}} في القضية {{caseRef}}.' },
  },
  AWARD_ISSUED: {
    type: NotificationType.CASE_UPDATE,
    en: { subject: 'Award issued — {{caseRef}}', body: 'An award has been issued in case {{caseRef}}. Recognition and enforcement remain subject to applicable law and conventions.' },
    ar: { subject: 'صدور حكم — {{caseRef}}', body: 'صدر حكم في القضية {{caseRef}}. ويظل الاعتراف والتنفيذ خاضعَين للقانون والاتفاقيات المعمول بها.' },
  },
  CORRECTION_DEADLINE: {
    type: NotificationType.DEADLINE,
    en: { subject: 'Correction/interpretation period — {{caseRef}}', body: 'The period to request a correction or interpretation of the award in case {{caseRef}} closes on {{dueDate}}.' },
    ar: { subject: 'مدة التصحيح/التفسير — {{caseRef}}', body: 'تنتهي مدة طلب تصحيح الحكم أو تفسيره في القضية {{caseRef}} بتاريخ {{dueDate}}.' },
  },
};

/** Replace `{{name}}` placeholders; unknown placeholders resolve to an empty string. */
export function interpolate(text: string, vars: Record<string, string | number | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? '' : String(v);
  });
}
