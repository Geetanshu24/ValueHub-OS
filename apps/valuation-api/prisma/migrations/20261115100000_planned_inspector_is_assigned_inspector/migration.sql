-- The inspector chosen at intake is the case's assigned inspector (the team columns added with the case workflow).
UPDATE "Assignment" SET "assignedInspectorId" = "plannedInspectorId" WHERE "assignedInspectorId" IS NULL AND "plannedInspectorId" IS NOT NULL;
ALTER TABLE "Assignment" DROP CONSTRAINT IF EXISTS "Assignment_plannedInspectorId_fkey";
ALTER TABLE "Assignment" DROP COLUMN "plannedInspectorId";
