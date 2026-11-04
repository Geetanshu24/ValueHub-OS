/*
  Warnings:

  - Added the required column `mimeType` to the `InspectionPhoto` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sha256` to the `InspectionPhoto` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "InspectionMeasurement" ADD COLUMN     "fieldKey" TEXT;

-- AlterTable
ALTER TABLE "InspectionPhoto" ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT NOT NULL;
