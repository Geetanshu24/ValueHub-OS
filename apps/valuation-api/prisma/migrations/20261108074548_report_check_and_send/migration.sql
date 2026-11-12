-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "reportSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "reportSubmittedById" TEXT;

-- CreateTable
CREATE TABLE "ReportCheck" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "checkedById" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSend" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "note" TEXT,
    "invoiceId" TEXT,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'RECORDED',
    "deliveryError" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportCheck_firmId_idx" ON "ReportCheck"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCheck_assignmentId_itemKey_key" ON "ReportCheck"("assignmentId", "itemKey");

-- CreateIndex
CREATE INDEX "ReportSend_assignmentId_idx" ON "ReportSend"("assignmentId");

-- CreateIndex
CREATE INDEX "ReportSend_firmId_idx" ON "ReportSend"("firmId");

-- AddForeignKey
ALTER TABLE "ReportCheck" ADD CONSTRAINT "ReportCheck_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCheck" ADD CONSTRAINT "ReportCheck_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSend" ADD CONSTRAINT "ReportSend_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSend" ADD CONSTRAINT "ReportSend_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every table (see 20261102120000_lock_tables_from_rest_api).
ALTER TABLE "ReportCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSend" ENABLE ROW LEVEL SECURITY;
