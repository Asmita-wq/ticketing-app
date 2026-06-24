import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  durationToMs,
} from '../utils/jwt';
import { env } from '../config/env';
import { sendMail, emailTemplates } from './mail.service';
import { recordAuditLog } from './audit.service';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Generate, store and email a 6-digit signup OTP. Falls back to logging the
// code when SMTP is not configured, so the flow is testable in development.
async function issueSignupOtp(email: string) {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  // Invalidate any previous unused codes for this email/purpose
  await prisma.emailOtp.updateMany({
    where: { email, purpose: 'SIGNUP', used: false },
    data: { used: true },
  });
  await prisma.emailOtp.create({
    data: { email, otp, purpose: 'SIGNUP', expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  if (!env.smtp.host) {
    logger.info(`[otp:dev] Signup OTP for ${email} is ${otp} (SMTP not configured)`);
  }
  await sendMail(email, 'Your verification code', emailTemplates.signupOtp(otp));
}

export async function registerUser(input: { name: string; email: string; password: string; phone?: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);

  if (existing) {
    // Only block if the account is fully set up (verified). An unverified record
    // is just an abandoned signup attempt — let the user re-register and re-send the code.
    if (existing.emailVerified) {
      throw ApiError.conflict('An account with this email already exists');
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { name: input.name, password: hashedPassword, phone: input.phone },
    });
    await issueSignupOtp(existing.email);
    return { email: existing.email, requiresVerification: true as const };
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      phone: input.phone,
      role: 'USER',
      emailVerified: false,
    },
  });

  await recordAuditLog({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    performedById: user.id,
  });

  await issueSignupOtp(user.email);

  // No tokens yet — the account must verify the emailed OTP first
  return { email: user.email, requiresVerification: true as const };
}

export async function verifyEmailOtp(email: string, otp: string) {
  const record = await prisma.emailOtp.findFirst({
    where: { email, purpose: 'SIGNUP', used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.otp !== otp) {
    throw ApiError.badRequest('Invalid verification code');
  }
  if (record.expiresAt < new Date()) {
    throw ApiError.badRequest('Verification code has expired. Please request a new one.');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw ApiError.badRequest('Account not found');

  await prisma.$transaction([
    prisma.emailOtp.update({ where: { id: record.id }, data: { used: true } }),
    prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
  ]);

  const tokens = await issueTokens(user.id, user.role, user.email);
  return { user: sanitizeUser({ ...user, emailVerified: true }), ...tokens };
}

export async function resendSignupOtp(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Respond success regardless to avoid leaking which emails exist
  if (!user || user.emailVerified) return;
  await issueSignupOtp(email);
}

export async function loginUser(email: string, password: string, ipAddress?: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      details: { email },
      ipAddress,
    });
    throw ApiError.unauthorized('Invalid email or password');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      details: { email },
      ipAddress,
    });
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Unverified accounts cannot log in — resend a fresh code and signal the client
  if (!user.emailVerified) {
    await issueSignupOtp(user.email);
    throw ApiError.forbidden('EMAIL_NOT_VERIFIED');
  }

  const tokens = await issueTokens(user.id, user.role, user.email);

  await recordAuditLog({
    action: 'LOGIN_SUCCESS',
    entityType: 'User',
    entityId: user.id,
    performedById: user.id,
    ipAddress,
  });

  return { user: sanitizeUser(user), ...tokens };
}

export async function issueTokens(userId: string, role: import('@prisma/client').UserRole, email: string) {
  const accessToken = signAccessToken({ sub: userId, role, email });
  const refreshToken = signRefreshToken({ sub: userId });

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId,
      expiresAt: new Date(Date.now() + durationToMs(env.jwt.refreshExpiresIn)),
    },
  });

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token is no longer valid');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or disabled');
  }

  // Rotate refresh token
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const tokens = await issueTokens(user.id, user.role, user.email);

  return { user: sanitizeUser(user), ...tokens };
}

export async function logoutUser(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revoked: true },
  });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always respond success to avoid leaking which emails are registered
  if (!user) return;

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  // Invalidate any previous unused reset codes for this email
  await prisma.emailOtp.updateMany({
    where: { email, purpose: 'RESET', used: false },
    data: { used: true },
  });
  await prisma.emailOtp.create({
    data: { email, otp, purpose: 'RESET', expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  if (!env.smtp.host) {
    logger.info(`[otp:dev] Password-reset OTP for ${email} is ${otp} (SMTP not configured)`);
  }
  await sendMail(email, 'Your password reset code', emailTemplates.passwordResetOtp(otp));
}

export async function resetPassword(email: string, otp: string, newPassword: string) {
  const record = await prisma.emailOtp.findFirst({
    where: { email, purpose: 'RESET', used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.otp !== otp) {
    throw ApiError.badRequest('Invalid reset code');
  }
  if (record.expiresAt < new Date()) {
    throw ApiError.badRequest('Reset code has expired. Please request a new one.');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw ApiError.badRequest('Invalid reset code');

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, mustChangePassword: false } }),
    prisma.emailOtp.update({ where: { id: record.id }, data: { used: true } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } }),
  ]);

  await recordAuditLog({
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: user.id,
    performedById: user.id,
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw ApiError.badRequest('Current password is incorrect');

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, mustChangePassword: false },
  });

  await recordAuditLog({
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: user.id,
    performedById: user.id,
  });
}

export function sanitizeUser<T extends { password: string }>(user: T): Omit<T, 'password'> {
  const { password, ...rest } = user;
  return rest;
}
