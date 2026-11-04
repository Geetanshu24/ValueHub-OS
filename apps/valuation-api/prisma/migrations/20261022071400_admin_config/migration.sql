-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldAt" TIMESTAMP(3),
ADD COLUMN     "legalHoldById" TEXT,
ADD COLUMN     "legalHoldReason" TEXT,
ADD COLUMN     "retainUntil" DATE;

-- CreateTable
CREATE TABLE "FirmSettings" (
    "firmId" TEXT NOT NULL,
    "retentionYears" INTEGER,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmSettings_pkey" PRIMARY KEY ("firmId")
);

-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "bankId" TEXT,
    "propertyClass" "PropertyClass",
    "amount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "propertyClass" "PropertyClass",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportChecklistResponse" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL,
    "note" TEXT,
    "checkedById" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportChecklistResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeRule_firmId_bankId_propertyClass_idx" ON "FeeRule"("firmId", "bankId", "propertyClass");

-- CreateIndex
CREATE INDEX "ChecklistItem_firmId_isActive_idx" ON "ChecklistItem"("firmId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReportChecklistResponse_reportVersionId_itemId_key" ON "ReportChecklistResponse"("reportVersionId", "itemId");

-- AddForeignKey
ALTER TABLE "ReportChecklistResponse" ADD CONSTRAINT "ReportChecklistResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

