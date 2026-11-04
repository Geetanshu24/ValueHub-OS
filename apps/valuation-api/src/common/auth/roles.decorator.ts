import { SetMetadata } from '@nestjs/common';
import type { ValuationRole } from '@value-hub/valuation-shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ValuationRole[]) => SetMetadata(ROLES_KEY, roles);
