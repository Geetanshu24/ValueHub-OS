-- CreateTable
CREATE TABLE "BankReportForm" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReportForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankReportForm_assignmentId_key" ON "BankReportForm"("assignmentId");

-- CreateIndex
CREATE INDEX "BankReportForm_firmId_idx" ON "BankReportForm"("firmId");

-- AddForeignKey
ALTER TABLE "BankReportForm" ADD CONSTRAINT "BankReportForm_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReportForm" ADD CONSTRAINT "BankReportForm_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every table (see 20261102120000_lock_tables_from_rest_api).
ALTER TABLE "BankReportForm" ENABLE ROW LEVEL SECURITY;
