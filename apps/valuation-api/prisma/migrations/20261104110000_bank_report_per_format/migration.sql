-- One saved form per assignment per bank format (an assignment can be exported in more than one).
DROP INDEX "BankReportForm_assignmentId_key";

-- CreateIndex
CREATE UNIQUE INDEX "BankReportForm_assignmentId_format_key" ON "BankReportForm"("assignmentId", "format");
