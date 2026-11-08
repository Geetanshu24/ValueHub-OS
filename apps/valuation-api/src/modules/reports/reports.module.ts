import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';
import { BankReportAiService } from './bank-report-ai.service.js';
import { BankReportController } from './bank-report.controller.js';
import { BankReportService } from './bank-report.service.js';
import { ReportPdfService } from './report-pdf.service.js';
import { ReportSnapshotService } from './report-snapshot.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { TemplatesService } from './templates.service.js';

@Module({
  imports: [NotificationsModule, AccountsModule],
  controllers: [ReportsController, BankReportController, DispatchController],
  providers: [DispatchService, BankReportService, BankReportAiService, ReportsService, TemplatesService, ReportSnapshotService, ReportPdfService],
})
export class ReportsModule {}
