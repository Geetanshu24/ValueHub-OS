-- CreateTable
CREATE TABLE "MarketRate" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "propertyClass" "PropertyClass" NOT NULL,
    "kind" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "ratePerSqm" DECIMAL(14,2) NOT NULL,
    "observedOn" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketRate_firmId_locality_idx" ON "MarketRate"("firmId", "locality");

-- CreateIndex
CREATE INDEX "MarketRate_firmId_observedOn_idx" ON "MarketRate"("firmId", "observedOn");

-- AddForeignKey
ALTER TABLE "MarketRate" ADD CONSTRAINT "MarketRate_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every table (see 20261102120000_lock_tables_from_rest_api).
ALTER TABLE "MarketRate" ENABLE ROW LEVEL SECURITY;
