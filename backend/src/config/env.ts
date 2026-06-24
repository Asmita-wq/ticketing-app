import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Comma-separated list of allowed browser origins (the Vaishnavi Group website,
// the admin SPA, localhost, etc.). Falls back to CLIENT_URL when unset.
const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.CLIENT_URL ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

const accessSecret = required('JWT_ACCESS_SECRET');
const refreshSecret = required('JWT_REFRESH_SECRET');

// In production, refuse to start with weak, default, or duplicate JWT secrets.
if (isProd) {
  const weak = ['change_this_access_secret', 'change_this_refresh_secret'];
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', accessSecret],
    ['JWT_REFRESH_SECRET', refreshSecret],
  ] as const) {
    if (value.length < 32 || weak.includes(value)) {
      throw new Error(
        `${name} is weak or using a default value. In production it must be a unique, random string of at least 32 characters (e.g. \`openssl rand -base64 48\`).`,
      );
    }
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }
}

export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT ?? 5000),
  clientUrl: required('CLIENT_URL', 'http://localhost:5173'),
  corsOrigins,

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    accessSecret,
    refreshSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Help Desk <support@helpdesk.com>',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR ?? 'uploads',
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 10),
  },

  resetPasswordUrl: process.env.RESET_PASSWORD_URL ?? 'http://localhost:5173/reset-password',

  msGraph: {
    tenantId: process.env.MSGRAPH_TENANT_ID ?? '',
    clientId: process.env.MSGRAPH_CLIENT_ID ?? '',
    clientSecret: process.env.MSGRAPH_CLIENT_SECRET ?? '',
    mailbox: process.env.MSGRAPH_MAILBOX ?? '',
    pollIntervalMs: Number(process.env.MSGRAPH_POLL_INTERVAL_MS ?? 60000),
  },
};
