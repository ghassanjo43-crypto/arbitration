/** Typed configuration loaded from environment. No secrets hard-coded. */
export interface AppConfig {
  nodeEnv: string;
  apiPort: number;
  publicWebUrl: string;
  corsOrigins: string[];
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: number;
    refreshTtl: number;
  };
  security: {
    passwordPepper: string;
    maxFailedLogins: number;
    accountLockMinutes: number;
    cookieSecret: string;
    rateLimitTtl: number;
    rateLimitMax: number;
  };
  storage: {
    driver: 'local' | 's3';
    localRoot: string;
    signedUrlTtl: number;
    maxUploadMb: number;
  };
  email: {
    driver: 'console' | 'smtp' | 'resend';
    from: string;
    resendApiKey?: string;
    /** Where new-registration notifications are sent (comma-separated). */
    adminNotificationEmail?: string;
  };
  payment: { driver: 'manual' | 'stripe' };
  video: { driver: 'placeholder' | 'zoom' | 'teams' | 'meet' };
  redisUrl: string;
}

function required(name: string, value: string | undefined, fallback?: string): string {
  const v = value ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Render (and most PaaS) inject PORT; prefer it, fall back to API_PORT.
  apiPort: parseInt(process.env.PORT ?? process.env.API_PORT ?? '4000', 10),
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // Allow a bare hostname (e.g. from a Render fromService binding) — assume https.
    .map((o) => (/^https?:\/\//.test(o) ? o : `https://${o}`)),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET, 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET, 'dev-refresh-secret-change-me'),
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? '1209600', 10),
  },
  security: {
    passwordPepper: process.env.PASSWORD_PEPPER ?? 'dev-pepper-change-me',
    maxFailedLogins: parseInt(process.env.MAX_FAILED_LOGINS ?? '5', 10),
    accountLockMinutes: parseInt(process.env.ACCOUNT_LOCK_MINUTES ?? '15', 10),
    cookieSecret: process.env.COOKIE_SECRET ?? 'dev-cookie-secret-change-me',
    rateLimitTtl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER as 'local' | 's3') ?? 'local',
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage',
    signedUrlTtl: parseInt(process.env.SIGNED_URL_TTL ?? '600', 10),
    maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB ?? '100', 10),
  },
  email: {
    driver: (process.env.EMAIL_DRIVER as 'console' | 'smtp' | 'resend') ?? 'console',
    // Falls back to Resend's shared testing sender (works without domain verification).
    from: process.env.EMAIL_FROM ?? 'Arbitration Panel <onboarding@resend.dev>',
    resendApiKey: process.env.RESEND_API_KEY,
    adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL,
  },
  payment: { driver: (process.env.PAYMENT_DRIVER as 'manual' | 'stripe') ?? 'manual' },
  video: { driver: (process.env.VIDEO_DRIVER as 'placeholder') ?? 'placeholder' },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
});
