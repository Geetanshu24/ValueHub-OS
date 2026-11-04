-- CreateEnum
CREATE TYPE "SubmissionChannel" AS ENUM ('EMAIL', 'PORTAL', 'COURIER', 'HAND_DELIVERY');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('RECORDED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'RECORDED',
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "sentById" TEXT NOT NULL,
DROP COLUMN "channel",
ADD COLUMN     "channel" "SubmissionChannel" NOT NULL;

