import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthedRequest } from './auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// A drafter or inspector may open a document, its facts or its file only when it belongs to a case given to them.
// Everyone else is unaffected. A file they may not see looks like one that does not exist.
@Injectable()
export class DocumentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest & { params: Record<string, string>; query: Record<string, string> }>();
    const user = request.user;
    if (user?.role !== 'DRAFTER' && user?.role !== 'INSPECTOR') return true;
    const { params, query } = request;

    let propertyId: string | undefined;
    if (params.id) propertyId = (await this.prisma.document.findFirst({ where: { id: params.id, firmId: user.firmId }, select: { propertyId: true } }))?.propertyId;
    else if (params.fieldId) propertyId = (await this.prisma.extractedField.findFirst({ where: { id: params.fieldId, firmId: user.firmId }, select: { document: { select: { propertyId: true } } } }))?.document.propertyId;
    else if (params.propertyId) propertyId = params.propertyId;
    else if (query.propertyId) propertyId = query.propertyId;
    else if (query.assignmentId) propertyId = (await this.prisma.assignment.findFirst({ where: { id: query.assignmentId, firmId: user.firmId }, select: { propertyId: true } }))?.propertyId;
    else throw new ForbiddenException('Open documents from the case they belong to');

    const mine = propertyId
      ? await this.prisma.assignment.findFirst({
          where: { firmId: user.firmId, propertyId, ...(user.role === 'DRAFTER' ? { assignedDrafterId: user.userId } : { assignedInspectorId: user.userId }) },
          select: { id: true },
        })
      : null;
    if (!mine) throw new NotFoundException('Document not found');
    return true;
  }
}
