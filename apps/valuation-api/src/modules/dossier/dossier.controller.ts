import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { BuildDossierDto } from './dossier.dto.js';
import { DossierService } from './dossier.service.js';

@Controller('assignments/:assignmentId/dossier')
export class DossierController {
  constructor(private readonly dossier: DossierService) {}

  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Get('plan')
  plan(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.dossier.plan(user.firmId, assignmentId);
  }

  // Building an archive hands records outside the system, so it is logged and limited to senior roles.
  @Roles('FIRM_ADMIN', 'VALUER', 'REVIEWER')
  @Post()
  async build(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: BuildDossierDto): Promise<StreamableFile> {
    const { fileName, buffer } = await this.dossier.build(user.firmId, user, assignmentId, dto.items, dto.redact);
    return new StreamableFile(buffer, { type: 'application/zip', disposition: `attachment; filename="${fileName}"` });
  }
}
