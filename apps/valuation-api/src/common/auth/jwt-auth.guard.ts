import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthedRequest } from './auth-user.js';
import { jwtSecret } from './jwt-config.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

// Registered globally (APP_GUARD): every route requires a valid token unless
// it is marked @Public().
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    let sub: string;
    try {
      const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub) throw new Error('Unexpected token payload');
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // The token only proves who it was issued to. Role, firm and active state
    // are read fresh, so deactivating or demoting someone takes effect at once.
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, firmId: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Account is not active');
    request.user = { userId: user.id, firmId: user.firmId, role: user.role };
    return true;
  }
}
