import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { unauthorized, forbidden } from '../lib/errors';
import { prisma } from '../lib/prisma';

export type AuthUser = {
  id: string;
  businessId: string;
  role: UserRole;
  phone: string;
  name: string;
  customerId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'orderproof-dev-secret';

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { ...user },
    JWT_SECRET as jwt.Secret,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  );
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    const user = await prisma.user.findFirst({
      where: { id: payload.id, businessId: payload.businessId, isActive: true },
      include: { customerProfile: true },
    });
    if (!user) throw unauthorized('Session expired. Please sign in again.');
    req.user = {
      id: user.id,
      businessId: user.businessId,
      role: user.role,
      phone: user.phone,
      name: user.name,
      customerId: user.customerProfile?.id,
    };
    next();
  } catch {
    next(unauthorized());
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Insufficient role'));
    next();
  };
}
