import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ValuationRole } from '@value-hub/valuation-shared';

// What the JWT guard attaches to the request. firmId comes from the signed
// token, never from the request body, so tenants cannot address each other.
export interface AuthUser {
  userId: string;
  firmId: string;
  role: ValuationRole;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
