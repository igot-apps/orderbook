import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/errors';
import { AuthUser, signToken } from '../middleware/auth';
import { writeAudit } from './auditService';

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '').trim();
}

export async function login(phone: string, password: string) {
  const normalized = normalizePhone(phone);
  const user = await prisma.user.findFirst({
    where: { phone: normalized, isActive: true },
    include: { customerProfile: true },
  });

  if (!user) throw unauthorized('Invalid phone or password');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid phone or password');

  const authUser: AuthUser = {
    id: user.id,
    businessId: user.businessId,
    role: user.role,
    phone: user.phone,
    name: user.name,
    customerId: user.customerProfile?.id,
  };

  const token = signToken(authUser);

  await writeAudit({
    businessId: user.businessId,
    actorId: user.id,
    entityType: 'User',
    entityId: user.id,
    action: 'LOGIN',
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      businessId: user.businessId,
      customerId: user.customerProfile?.id,
    },
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      customerProfile: true,
      business: { include: { settings: true } },
    },
  });
  if (!user) throw unauthorized();
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    businessId: user.businessId,
    customerId: user.customerProfile?.id,
    business: {
      id: user.business.id,
      name: user.business.name,
      settings: user.business.settings,
    },
    creditAllowed: user.customerProfile?.creditAllowed ?? null,
  };
}
