-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'LAYOUT_PLAN';
ALTER TYPE "DocumentType" ADD VALUE 'COMPLETION_CERTIFICATE';
ALTER TYPE "DocumentType" ADD VALUE 'ELECTRICITY_BILL';
ALTER TYPE "DocumentType" ADD VALUE 'PROPERTY_TAX';
ALTER TYPE "DocumentType" ADD VALUE 'REGISTRY_PAPERS';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "assignedDrafterId" TEXT,
ADD COLUMN     "assignedInspectorId" TEXT,
ADD COLUMN     "clientPhone" TEXT;

-- AlterTable
ALTER TABLE "BankBranch" ADD COLUMN     "district" TEXT,
ADD COLUMN     "state" TEXT;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedDrafterId_fkey" FOREIGN KEY ("assignedDrafterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedInspectorId_fkey" FOREIGN KEY ("assignedInspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
