-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('NOT_RUN', 'DONE', 'NO_TEXT', 'FAILED');

-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('MANUAL', 'OCR');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ocrAt" TIMESTAMP(3),
ADD COLUMN     "ocrError" TEXT,
ADD COLUMN     "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NOT_RUN',
ADD COLUMN     "ocrText" TEXT;

-- AlterTable
ALTER TABLE "ExtractedField" ADD COLUMN     "source" "FieldSource" NOT NULL DEFAULT 'MANUAL';

