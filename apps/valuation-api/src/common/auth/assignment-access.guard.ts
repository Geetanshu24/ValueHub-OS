import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthedRequest } from './auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// For routes under /assignments/:assignmentId/...: a drafter or inspector may only reach a case
// that was given to them. Everyone else is unaffected. A case they may not see looks like one that does not exist.
@Injectable()
export class AssignmentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest & { params: Record<string, string>; route?: { path?: string } }>();
    const user = request.user;
    if (user?.role !== 'DRAFTER' && user?.role !== 'INSPECTOR') return true;
    // Routes name the case either assignmentId or, on the assignments controller itself, id.
    const id = request.params.assignmentId ?? (request.route?.path?.includes('assignments/:id') ? request.params.id : undefined);
    if (!id) return true;
    const mine = user.role === 'DRAFTER' ? { assignedDrafterId: user.userId } : { assignedInspectorId: user.userId };
    const found = id ? await this.prisma.assignment.findFirst({ where: { id, firmId: user.firmId, ...mine }, select: { id: true } }) : null;
    if (!found) throw new NotFoundException('Assignment not found');
    return true;
  }
}
