import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AuditService } from '../../common/audit/audit.service.js';
import { createHash, randomBytes } from 'node:crypto';
import { LoginThrottle } from './login-throttle.js';
import { MailService } from '../../common/mail/mail.service.js';
import { jwtExpiresIn, jwtSecret } from '../../common/auth/jwt-config.js';
import { hashPassword, verifyPassword } from '../../common/auth/password.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const publicUser = {
  id: true,
  firmId: true,
  email: true,
  fullName: true,
  role: true,
} as const;

// Verified against when the email is unknown, so a missing account costs the
// same time as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottle,
    private readonly mail: MailService,
  ) {}

  async login(email: string, password: string) {
    const key = email.toLowerCase();
    this.throttle.assertAllowed(key);
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { ...publicUser, passwordHash: true, isActive: true },
    });

    const valid = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !user.isActive || !valid) {
      this.throttle.recordFailure(key);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.throttle.reset(key);

    const accessToken = jwt.sign({ firmId: user.firmId, role: user.role }, jwtSecret(), {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn: jwtExpiresIn() as jwt.SignOptions['expiresIn'],
    });

    const { passwordHash: _hash, isActive: _active, ...profile } = user;
    return { accessToken, user: profile };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: publicUser });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, firmId: true } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new BadRequestException('New password must differ from the current one');

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.audit.record({ firmId: user.firmId, actorId: userId, entityType: 'User', entityId: userId, action: 'user.password_changed' }, tx);
    });
    return { ok: true };
  }

  // Always answers the same way, so it cannot be used to find out who has an account.
  async forgotPassword(email: string) {
    const key = `reset:${email.toLowerCase()}`;
    this.throttle.assertAllowed(key);
    this.throttle.recordFailure(key); // every request counts, so it cannot be used to flood someone's inbox

    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, firmId: true, isActive: true, fullName: true } });
    if (user?.isActive && this.mail.isConfigured) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      const base = process.env.WEB_URL ?? 'http://localhost:5174';
      await this.mail.send({
        to: email,
        subject: 'Reset your ValueHub OS password',
        text: `Hello ${user.fullName},\n\nUse this link within one hour to choose a new password:\n${base}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email; your password has not changed.`,
      }).catch(() => undefined);
      await this.audit.record({ firmId: user.firmId, actorId: user.id, entityType: 'User', entityId: user.id, action: 'user.password_reset_requested' });
    }
    return { ok: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException('This reset link is invalid or has expired');
    const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { firmId: true, isActive: true } });
    if (!user?.isActive) throw new BadRequestException('This reset link is invalid or has expired');

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count !== 1) throw new BadRequestException('This reset link is invalid or has expired');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await this.audit.record({ firmId: user.firmId, actorId: row.userId, entityType: 'User', entityId: row.userId, action: 'user.password_reset' }, tx);
    });
    return { ok: true };
  }
}
