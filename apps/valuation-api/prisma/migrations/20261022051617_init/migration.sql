-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FIRM_ADMIN', 'VALUER', 'INSPECTOR', 'REVIEWER', 'ACCOUNTS');

-- CreateEnum
CREATE TYPE "PropertyClass" AS ENUM ('FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('INTAKE', 'DOCUMENTS', 'INSPECTION', 'VALUATION', 'QUALITY_REVIEW', 'APPROVED', 'SUBMITTED', 'REVISION', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BANK_INSTRUCTION', 'SALE_DEED', 'APPROVED_PLAN', 'REVENUE_RECORD', 'TAX_RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('UNVERIFIED', 'VERIFIED', 'CORRECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'DISCLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ISSUED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LineItemTreatment" AS ENUM ('INCLUDED_IN_BASE_RATE', 'SEPARATELY_VALUED', 'NOT_APPLICABLE', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdSequence" (
    "firmId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IdSequence_pkey" PRIMARY KEY ("firmId","key")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankBranch" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "propertyClass" "PropertyClass" NOT NULL,
    "addressLine" TEXT NOT NULL,
    "unitDetail" TEXT,
    "locality" TEXT,
    "village" TEXT,
    "tehsil" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "khasraNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "boundaries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "branchId" TEXT,
    "propertyId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT,
    "valuationDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fee" DECIMAL(12,2),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'INTAKE',
    "assignedValuerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "extractedValue" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "confidence" DECIMAL(4,3),
    "state" "VerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedValue" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "observations" JSONB,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionMeasurement" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "areaSqm" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "InspectionMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionPhoto" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "captionConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "takenAt" TIMESTAMP(3),

    CONSTRAINT "InspectionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "valueA" TEXT NOT NULL,
    "sourceA" TEXT NOT NULL,
    "valueB" TEXT NOT NULL,
    "sourceB" TEXT NOT NULL,
    "material" BOOLEAN NOT NULL DEFAULT true,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketComparable" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isTransaction" BOOLEAN NOT NULL,
    "observedOn" DATE NOT NULL,
    "areaBasis" TEXT NOT NULL,
    "ratePerSqm" DECIMAL(14,2) NOT NULL,
    "adjustments" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "relevanceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketComparable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationVersion" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "method" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "areaBasis" TEXT NOT NULL,
    "adoptedAreaSqm" DECIMAL(12,2) NOT NULL,
    "assumptions" TEXT,
    "totalValue" DECIMAL(16,2) NOT NULL,
    "changeReason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationLineItem" (
    "id" TEXT NOT NULL,
    "valuationVersionId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "treatment" "LineItemTreatment" NOT NULL DEFAULT 'REQUIRES_REVIEW',
    "sourceNote" TEXT,
    "overrideReason" TEXT,

    CONSTRAINT "ValuationLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "bankId" TEXT,
    "name" TEXT NOT NULL,
    "propertyClass" "PropertyClass",
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "fieldMap" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportVersion" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "valuationVersionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "storageKey" TEXT,
    "sha256" TEXT,
    "reviewerId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedOn" DATE NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankQuery" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_firmId_idx" ON "User"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_firmId_name_key" ON "Bank"("firmId", "name");

-- CreateIndex
CREATE INDEX "BankBranch_firmId_idx" ON "BankBranch"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "BankBranch_bankId_name_key" ON "BankBranch"("bankId", "name");

-- CreateIndex
CREATE INDEX "Property_firmId_district_idx" ON "Property"("firmId", "district");

-- CreateIndex
CREATE INDEX "Property_firmId_pinCode_idx" ON "Property"("firmId", "pinCode");

-- CreateIndex
CREATE UNIQUE INDEX "Property_firmId_code_key" ON "Property"("firmId", "code");

-- CreateIndex
CREATE INDEX "Assignment_firmId_status_idx" ON "Assignment"("firmId", "status");

-- CreateIndex
CREATE INDEX "Assignment_firmId_dueDate_idx" ON "Assignment"("firmId", "dueDate");

-- CreateIndex
CREATE INDEX "Assignment_firmId_bankId_idx" ON "Assignment"("firmId", "bankId");

-- CreateIndex
CREATE INDEX "Assignment_propertyId_idx" ON "Assignment"("propertyId");

-- CreateIndex
CREATE INDEX "Assignment_assignedValuerId_idx" ON "Assignment"("assignedValuerId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_firmId_code_key" ON "Assignment"("firmId", "code");

-- CreateIndex
CREATE INDEX "Document_firmId_propertyId_idx" ON "Document"("firmId", "propertyId");

-- CreateIndex
CREATE INDEX "Document_assignmentId_idx" ON "Document"("assignmentId");

-- CreateIndex
CREATE INDEX "ExtractedField_documentId_idx" ON "ExtractedField"("documentId");

-- CreateIndex
CREATE INDEX "ExtractedField_firmId_state_idx" ON "ExtractedField"("firmId", "state");

-- CreateIndex
CREATE INDEX "Inspection_firmId_assignmentId_idx" ON "Inspection"("firmId", "assignmentId");

-- CreateIndex
CREATE INDEX "Inspection_inspectorId_idx" ON "Inspection"("inspectorId");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_inspectionId_idx" ON "InspectionMeasurement"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");

-- CreateIndex
CREATE INDEX "Discrepancy_assignmentId_status_idx" ON "Discrepancy"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "Discrepancy_firmId_status_idx" ON "Discrepancy"("firmId", "status");

-- CreateIndex
CREATE INDEX "MarketComparable_assignmentId_idx" ON "MarketComparable"("assignmentId");

-- CreateIndex
CREATE INDEX "ValuationVersion_firmId_idx" ON "ValuationVersion"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationVersion_assignmentId_versionNumber_key" ON "ValuationVersion"("assignmentId", "versionNumber");

-- CreateIndex
CREATE INDEX "ValuationLineItem_valuationVersionId_idx" ON "ValuationLineItem"("valuationVersionId");

-- CreateIndex
CREATE INDEX "ReportTemplate_firmId_bankId_propertyClass_idx" ON "ReportTemplate"("firmId", "bankId", "propertyClass");

-- CreateIndex
CREATE INDEX "ReportVersion_firmId_idx" ON "ReportVersion"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportVersion_assignmentId_versionNumber_key" ON "ReportVersion"("assignmentId", "versionNumber");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_idx" ON "Submission"("assignmentId");

-- CreateIndex
CREATE INDEX "Invoice_firmId_status_dueOn_idx" ON "Invoice"("firmId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "Invoice_assignmentId_idx" ON "Invoice"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_firmId_code_key" ON "Invoice"("firmId", "code");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "BankQuery_firmId_status_dueAt_idx" ON "BankQuery"("firmId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankQuery_firmId_code_key" ON "BankQuery"("firmId", "code");

-- CreateIndex
CREATE INDEX "AuditEvent_firmId_entityType_entityId_idx" ON "AuditEvent"("firmId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_firmId_createdAt_idx" ON "AuditEvent"("firmId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdSequence" ADD CONSTRAINT "IdSequence_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bank" ADD CONSTRAINT "Bank_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBranch" ADD CONSTRAINT "BankBranch_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBranch" ADD CONSTRAINT "BankBranch_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "BankBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedValuerId_fkey" FOREIGN KEY ("assignedValuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionPhoto" ADD CONSTRAINT "InspectionPhoto_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketComparable" ADD CONSTRAINT "MarketComparable_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketComparable" ADD CONSTRAINT "MarketComparable_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationVersion" ADD CONSTRAINT "ValuationVersion_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationVersion" ADD CONSTRAINT "ValuationVersion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationLineItem" ADD CONSTRAINT "ValuationLineItem_valuationVersionId_fkey" FOREIGN KEY ("valuationVersionId") REFERENCES "ValuationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_valuationVersionId_fkey" FOREIGN KEY ("valuationVersionId") REFERENCES "ValuationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "ReportVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankQuery" ADD CONSTRAINT "BankQuery_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankQuery" ADD CONSTRAINT "BankQuery_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
