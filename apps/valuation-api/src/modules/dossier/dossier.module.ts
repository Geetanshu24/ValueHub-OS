import { Module } from '@nestjs/common';
import { DossierController } from './dossier.controller.js';
import { DossierService } from './dossier.service.js';

@Module({
  controllers: [DossierController],
  providers: [DossierService],
})
export class DossierModule {}
