/*
  Warnings:

  - Added the required column `recordedById` to the `MarketComparable` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MarketComparable" ADD COLUMN     "recordedById" TEXT NOT NULL;
