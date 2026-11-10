-- AlterTable
ALTER TABLE "ExtractedField" ADD COLUMN     "enteredById" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "ComparisonDecision" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "documentValue" TEXT NOT NULL,
    "siteValue" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparisonDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReworkRequest" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dueDate" DATE,
    "assignedToId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ReworkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalReport" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" JSONB NOT NULL,

    CONSTRAINT "FinalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparisonDecision_firmId_idx" ON "ComparisonDecision"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonDecision_assignmentId_factKey_key" ON "ComparisonDecision"("assignmentId", "factKey");

-- CreateIndex
CREATE INDEX "ReworkRequest_assignmentId_resolvedAt_idx" ON "ReworkRequest"("assignmentId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReworkRequest_firmId_idx" ON "ReworkRequest"("firmId");

-- CreateIndex
CREATE INDEX "FinalReport_assignmentId_idx" ON "FinalReport"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalReport_firmId_reportNumber_key" ON "FinalReport"("firmId", "reportNumber");

-- AddForeignKey
ALTER TABLE "ComparisonDecision" ADD CONSTRAINT "ComparisonDecision_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonDecision" ADD CONSTRAINT "ComparisonDecision_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkRequest" ADD CONSTRAINT "ReworkRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkRequest" ADD CONSTRAINT "ReworkRequest_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every table (see 20261102120000_lock_tables_from_rest_api).
ALTER TABLE "ComparisonDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReworkRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinalReport" ENABLE ROW LEVEL SECURITY;
