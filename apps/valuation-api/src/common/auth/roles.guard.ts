import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ValuationRole } from '@value-hub/valuation-shared';
import type { AuthedRequest } from './auth-user.js';
import { ROLES_KEY } from './roles.decorator.js';

// Runs after JwtAuthGuard. Routes without @Roles() are open to any
// authenticated user of the firm.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ValuationRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
