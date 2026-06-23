/**
 * Data-retention policy. SAFE DEFAULTS that never auto-delete the legally
 * significant record classes (awards, audit logs, service evidence). Periods are
 * engineering defaults and MUST be set by qualified privacy/arbitration counsel
 * per seat before production use (see docs/DATA_RETENTION.md).
 *
 * Behaviour:
 *   RETAIN_FOREVER  — never eligible for deletion (safeguard). A sweep reports it
 *                     as RETAINED and refuses to delete it.
 *   SOFT_DELETE     — past the period → soft-delete (set deletedAt), preserving a
 *                     tombstone + content hash. The arbitral record survives.
 *   REVIEW          — past the period → mark ELIGIBLE_FOR_REVIEW only; a human
 *                     must decide. Never auto-deleted.
 */
export type RetentionBehavior = 'RETAIN_FOREVER' | 'SOFT_DELETE' | 'REVIEW';

export const RETENTION_CATEGORIES = [
  'CASE_RECORD',
  'FILING',
  'EVIDENCE_DOCUMENT',
  'AWARD',
  'NOTICE_CERTIFICATE',
  'AUDIT_LOG',
  'EMAIL_EVIDENCE',
  'COMPLIANCE_SCREENING',
  'USER_ACCOUNT',
  'AUTH_LOG',
  'CMS_CONTENT',
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export interface CategoryPolicy {
  /** Days after the anchor date before the record is past its period. 0 = N/A. */
  days: number;
  behavior: RetentionBehavior;
  /** Human description of the retention rule + anchor. */
  description: string;
}

const DAY = 1;
const YEAR = 365 * DAY;

/** Default policy. Override individual periods via the `retention.policy` SystemSetting. */
export const DEFAULT_RETENTION_POLICY: Record<RetentionCategory, CategoryPolicy> = {
  CASE_RECORD: { days: 10 * YEAR, behavior: 'SOFT_DELETE', description: 'Closed case file — soft-deleted 10 years after closure (limitation/enforcement window).' },
  FILING: { days: 10 * YEAR, behavior: 'SOFT_DELETE', description: 'Pleadings/filings — retained with the case file.' },
  EVIDENCE_DOCUMENT: { days: 10 * YEAR, behavior: 'SOFT_DELETE', description: 'Evidence/exhibits — retained with the case file.' },
  AWARD: { days: 0, behavior: 'RETAIN_FOREVER', description: 'Awards (and generated PDFs) — retained indefinitely; never auto-deleted.' },
  NOTICE_CERTIFICATE: { days: 0, behavior: 'RETAIN_FOREVER', description: 'Notices & certificates of service — service evidence; retained indefinitely.' },
  AUDIT_LOG: { days: 0, behavior: 'RETAIN_FOREVER', description: 'Audit log — append-only; retained indefinitely.' },
  EMAIL_EVIDENCE: { days: 7 * YEAR, behavior: 'REVIEW', description: 'Email delivery evidence — flagged for review after 7 years; never auto-deleted (service evidence).' },
  COMPLIANCE_SCREENING: { days: 5 * YEAR, behavior: 'REVIEW', description: 'KYC/AML screening records — flagged for review after 5 years (AML retention).' },
  USER_ACCOUNT: { days: 3 * YEAR, behavior: 'REVIEW', description: 'Deactivated user accounts — flagged for review 3 years after deactivation.' },
  AUTH_LOG: { days: 1 * YEAR, behavior: 'REVIEW', description: 'Authentication/login history — flagged for review after 1 year.' },
  CMS_CONTENT: { days: 0, behavior: 'REVIEW', description: 'Public CMS content — managed manually (archive/publish), not auto-deleted.' },
};
