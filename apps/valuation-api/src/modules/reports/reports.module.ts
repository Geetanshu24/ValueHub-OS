import { Module } from '@nestjs/common';
import { BankReportAiService } from './bank-report-ai.service.js';
import { BankReportController } from './bank-report.controller.js';
import { BankReportService } from './bank-report.service.js';
import { ReportPdfService } from './report-pdf.service.js';
import { ReportSnapshotService } from './report-snapshot.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { TemplatesService } from './templates.service.js';

@Module({
  controllers: [ReportsController, BankReportController],
  providers: [BankReportService, BankReportAiService, ReportsService, TemplatesService, ReportSnapshotService, ReportPdfService],
})
export class ReportsModule {}
