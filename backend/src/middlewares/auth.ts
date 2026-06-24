import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken, AccessTokenPayload } from '../utils/jwt';
import { prisma } from '../config/prisma';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or invalid authorization header');
  }

  const token = header.substring('Bearer '.length);

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }

  // Enforce account state on every request so a disabled (or deleted) user is
  // rejected immediately — not only after their access token expires.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isActive: true },
  });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Your account has been disabled.');
  }

  req.user = payload;
  next();
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to perform this action');
    }
    next();
  };
}

// Role hierarchy after rename: ADMIN (top) > MANAGER > SUPPORT_AGENT > USER
export const STAFF_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'SUPPORT_AGENT'];
// Administrative roles (admin + manager) — may manage agents, categories, SLA, etc.
export const ADMIN_ROLES: UserRole[] = ['ADMIN', 'MANAGER'];
// Top-tier only — may create/manage other admins
export const ADMIN_ONLY_ROLES: UserRole[] = ['ADMIN'];
