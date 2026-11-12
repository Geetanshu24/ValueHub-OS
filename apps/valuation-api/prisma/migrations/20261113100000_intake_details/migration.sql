-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "bankOfficerName" TEXT,
ADD COLUMN "bankOfficerMobile" TEXT,
ADD COLUMN "loanAccountNo" TEXT,
ADD COLUMN "applicantFatherName" TEXT,
ADD COLUMN "applicantMobile" TEXT,
ADD COLUMN "applicantEmail" TEXT,
ADD COLUMN "billingArrangement" TEXT,
ADD COLUMN "specialInstructions" TEXT,
ADD COLUMN "approxAreaSqm" DECIMAL(14,2),
ADD COLUMN "plannedInspectorId" TEXT;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_plannedInspectorId_fkey" FOREIGN KEY ("plannedInspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
