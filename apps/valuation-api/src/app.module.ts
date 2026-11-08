import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './modules/ai/ai.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { MailModule } from './common/mail/mail.module.js';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard.js';
import { RolesGuard } from './common/auth/roles.guard.js';
import { HealthController } from './health/health.controller.js';
import { AdminConfigModule } from './modules/admin-config/admin-config.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AuditViewModule } from './modules/audit/audit-view.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { AssignmentsModule } from './modules/assignments/assignments.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BanksModule } from './modules/banks/banks.module.js';
import { ComparablesModule } from './modules/comparables/comparables.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DossierModule } from './modules/dossier/dossier.module.js';
import { DiscrepanciesModule } from './modules/discrepancies/discrepancies.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { IntakeModule } from './modules/intake/intake.module.js';
import { IdsModule } from './modules/ids/ids.module.js';
import { InspectionsModule } from './modules/inspections/inspections.module.js';
import { QueriesModule } from './modules/queries/queries.module.js';
import { OcrModule } from './modules/ocr/ocr.module.js';
import { PropertiesModule } from './modules/properties/properties.module.js';
import { ValuationsModule } from './modules/valuations/valuations.module.js';
import { RevisionsModule } from './modules/revisions/revisions.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SubmissionsModule } from './modules/submissions/submissions.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AiModule,
    StorageModule,
    MailModule,
    IdsModule,
    AuthModule,
    BanksModule,
    PropertiesModule,
    AssignmentsModule,
    DocumentsModule,
    DiscrepanciesModule,
    InspectionsModule,
    UsersModule,
    ValuationsModule,
    AuditViewModule,
    NotificationsModule,
    ComparablesModule,
    ReportsModule,
    SubmissionsModule,
    DashboardModule,
    QueriesModule,
    RevisionsModule,
    AccountsModule,
    AdminConfigModule,
    OcrModule,
    IntakeModule,
    SearchModule,
    DossierModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then check the role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
