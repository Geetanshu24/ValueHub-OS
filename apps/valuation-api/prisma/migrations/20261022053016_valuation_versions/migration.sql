/*
  Warnings:

  - Added the required column `sortOrder` to the `ValuationLineItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `adoptedAreaSource` to the `ValuationVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inputs` to the `ValuationVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ValuationLineItem" ADD COLUMN     "sortOrder" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ValuationVersion" ADD COLUMN     "adoptedAreaSource" TEXT NOT NULL,
ADD COLUMN     "inputs" JSONB NOT NULL;
