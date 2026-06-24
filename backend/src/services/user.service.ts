import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { sanitizeUser } from './auth.service';
import { getPaginationParams, buildPaginatedResult } from '../utils/pagination';
import { recordAuditLog } from './audit.service';
import { sendMail, emailTemplates } from './mail.service';
import { env } from '../config/env';

const SALT_ROUNDS = 10;

interface ListUsersParams {
  page?: number;
  limit?: number;
  role?: UserRole;
  search?: string;
  isActive?: boolean;
}

export async function listUsers(params: ListUsersParams) {
  const { page, limit, skip } = getPaginationParams(params);

  const where: Prisma.UserWhereInput = {};
  if (params.role) where.role = params.role;
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);

  return buildPaginatedResult(data.map((u) => sanitizeUser(u)), total, page, limit);
}

export async function listAgents() {
  const agents = await prisma.user.findMany({
    where: { role: { in: ['SUPPORT_AGENT', 'MANAGER', 'ADMIN'] }, isActive: true },
    orderBy: { name: 'asc' },
  });
  return agents.map((a) => sanitizeUser(a));
}

// Active end-users — used by staff when raising a ticket on behalf of a user
export async function listCustomers(search?: string) {
  const where: Prisma.UserWhereInput = { role: 'USER', isActive: true };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 100,
    select: { id: true, name: true, email: true },
  });
  return users;
}

// Generate a strong, unique random password (12 chars: upper, lower, digit, symbol).
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*?';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  // Guarantee at least one of each class, then fill to length 12
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = chars.length; i < 12; i++) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed chars aren't always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function createAgent(
  input: { name: string; email: string; password?: string; phone?: string; role: UserRole; department?: string },
  performedBy: { id: string; role: UserRole },
) {
  // Only top-tier Admins may create other Admins
  if (input.role === 'ADMIN' && performedBy.role !== 'ADMIN') {
    throw ApiError.forbidden('Only an Admin can create an Admin account');
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  // Auto-generate a unique password when the admin doesn't supply one
  const plainPassword = input.password && input.password.length >= 8 ? input.password : generatePassword();
  const hashedPassword = await bcrypt.hash(plainPassword, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      phone: input.phone,
      role: input.role,
      department: input.department,
      // Accounts created by an admin/manager are pre-verified (no OTP needed)
      emailVerified: true,
      // ...but must set their own password on first login (they got a temp one by email)
      mustChangePassword: true,
    },
  });

  await recordAuditLog({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    performedById: performedBy.id,
    details: { role: user.role },
  });

  // Email the new account holder their login credentials
  await sendMail(
    user.email,
    'Your Vaishnavi Group Help Desk account',
    emailTemplates.accountCreated(
      user.name,
      user.email,
      plainPassword,
      user.role,
      `${env.clientUrl}/login`,
    ),
  );

  return sanitizeUser(user);
}

export async function updateAgent(
  id: string,
  input: { name?: string; phone?: string; department?: string; role?: UserRole; isActive?: boolean },
  performedBy: { id: string; role: UserRole },
) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('User not found');

  // No one can disable themselves or change their own role
  if (performedBy.id === id) {
    if (input.isActive === false) {
      throw ApiError.badRequest('You cannot disable your own account.');
    }
    if (input.role && input.role !== existing.role) {
      throw ApiError.badRequest('You cannot change your own role.');
    }
  }

  // Managers cannot manage Admin accounts, nor promote anyone to Admin
  if (performedBy.role !== 'ADMIN') {
    if (existing.role === 'ADMIN') {
      throw ApiError.forbidden('Only an Admin can manage an Admin account');
    }
    if (input.role === 'ADMIN') {
      throw ApiError.forbidden('Only an Admin can promote a user to Admin');
    }
  }

  const user = await prisma.user.update({ where: { id }, data: input });

  // Disabling an account immediately revokes its refresh tokens so it can't
  // obtain new access tokens (combined with the per-request isActive check,
  // this logs the user out everywhere on their next request).
  if (input.isActive === false) {
    await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
  }

  await recordAuditLog({
    action: input.isActive === false ? 'USER_DISABLED' : 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    performedById: performedBy.id,
    details: input,
  });

  return sanitizeUser(user);
}

const ROLE_RANK: Record<UserRole, number> = { ADMIN: 3, MANAGER: 2, SUPPORT_AGENT: 1, USER: 0 };

// A higher-privileged user resets a lower user's password: generates a new
// temporary password, emails it, and forces a change on next login.
export async function resetUserPassword(targetId: string, performedBy: { id: string; role: UserRole }) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw ApiError.notFound('User not found');

  if (ROLE_RANK[performedBy.role] <= ROLE_RANK[target.role]) {
    throw ApiError.forbidden('You can only reset the password of users with a lower role than yours.');
  }

  const newPassword = generatePassword();
  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { password: hashedPassword, mustChangePassword: true },
    }),
    prisma.refreshToken.updateMany({ where: { userId: targetId }, data: { revoked: true } }),
  ]);

  await recordAuditLog({
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: targetId,
    performedById: performedBy.id,
    details: { byAdmin: true },
  });

  await sendMail(
    target.email,
    'Your Vaishnavi Group Help Desk password was reset',
    emailTemplates.accountCreated(target.name, target.email, newPassword, target.role, `${env.clientUrl}/login`),
  );

  return { success: true };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');
  return sanitizeUser(user);
}
