-- CreateEnum
CREATE TYPE "QueryKind" AS ENUM ('QUERY', 'REVISION_REQUEST');

-- AlterTable
ALTER TABLE "BankQuery" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedById" TEXT,
ADD COLUMN     "escalationNote" TEXT,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "kind" "QueryKind" NOT NULL DEFAULT 'QUERY',
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "respondedById" TEXT,
ADD COLUMN     "responseDelivery" "DeliveryStatus",
ADD COLUMN     "responseSentTo" TEXT;

-- AlterTable
ALTER TABLE "ReportVersion" ADD COLUMN     "changeReason" TEXT;

-- CreateIndex
CREATE INDEX "BankQuery_assignmentId_idx" ON "BankQuery"("assignmentId");

