-- CreateEnum
CREATE TYPE "FollowUpChannel" AS ENUM ('EMAIL', 'CALL', 'VISIT', 'OTHER');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "recordedById" TEXT NOT NULL,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateTable
CREATE TABLE "InvoiceFollowUp" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "channel" "FollowUpChannel" NOT NULL,
    "note" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextActionOn" DATE,
    "sentTo" TEXT,
    "delivery" "DeliveryStatus",
    "createdById" TEXT NOT NULL,

    CONSTRAINT "InvoiceFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceFollowUp_invoiceId_idx" ON "InvoiceFollowUp"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceFollowUp" ADD CONSTRAINT "InvoiceFollowUp_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

