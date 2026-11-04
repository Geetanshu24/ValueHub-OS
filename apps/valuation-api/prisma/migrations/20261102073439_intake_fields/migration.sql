-- CreateEnum
CREATE TYPE "IntakeSource" AS ENUM ('WHATSAPP', 'EMAIL', 'MOBILE_APP', 'DASHBOARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "borrowerName" TEXT,
ADD COLUMN     "instructionDate" DATE,
ADD COLUMN     "intakeSource" "IntakeSource" NOT NULL DEFAULT 'DASHBOARD',
ADD COLUMN     "priority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "reusedFromId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "source" "IntakeSource" NOT NULL DEFAULT 'DASHBOARD';

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_reusedFromId_fkey" FOREIGN KEY ("reusedFromId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
