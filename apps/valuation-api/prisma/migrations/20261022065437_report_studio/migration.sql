-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ReportVersion" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "qc" JSONB NOT NULL,
ADD COLUMN     "snapshot" JSONB NOT NULL,
ALTER COLUMN "storageKey" SET NOT NULL,
ALTER COLUMN "sha256" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_firmId_name_version_key" ON "ReportTemplate"("firmId", "name", "version");

