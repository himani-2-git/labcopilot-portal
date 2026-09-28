-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('draft', 'entered', 'validated', 'analytically_ready');

-- CreateEnum
CREATE TYPE "ResultValueKind" AS ENUM ('numeric', 'text', 'coded');

-- AlterTable
ALTER TABLE "LaboratoryTest" ADD COLUMN     "analyticalPolicy" JSONB;

-- CreateTable
CREATE TABLE "AnalyticalResult" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "specimenId" UUID NOT NULL,
    "accessionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'draft',
    "valueKind" "ResultValueKind" NOT NULL,
    "numericInput" TEXT,
    "numericValue" DECIMAL(38,18),
    "textValue" TEXT,
    "codedValue" TEXT,
    "unit" TEXT,
    "policy" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "qc" JSONB NOT NULL,
    "readiness" TEXT NOT NULL DEFAULT 'pending',
    "criticalReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "enteredBy" TEXT,
    "enteredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnalyticalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRevision" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "previousRevisionId" UUID,
    "action" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT,
    "valueKind" "ResultValueKind" NOT NULL,
    "numericValue" DECIMAL(38,18),
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticalResult_facilityId_status_updatedAt_idx" ON "AnalyticalResult"("facilityId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AnalyticalResult_patientId_updatedAt_idx" ON "AnalyticalResult"("patientId", "updatedAt");

-- CreateIndex
CREATE INDEX "AnalyticalResult_specimenId_idx" ON "AnalyticalResult"("specimenId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticalResult_accessionId_orderItemId_testId_key" ON "AnalyticalResult"("accessionId", "orderItemId", "testId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultRevision_previousRevisionId_key" ON "ResultRevision"("previousRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultRevision_resultId_version_key" ON "ResultRevision"("resultId", "version");

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LaboratoryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "LaboratoryOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LaboratoryTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_accessionId_fkey" FOREIGN KEY ("accessionId") REFERENCES "Accession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AnalyticalResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "ResultRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_state_check" CHECK (
  "version" > 0 AND "readiness" IN ('pending','blocked','ready')
  AND ("status" NOT IN ('validated','analytically_ready') OR "validation"->>'outcome' = 'passed')
  AND (("status" = 'analytically_ready') = ("readiness" = 'ready'))
  AND ("status" <> 'analytically_ready' OR "qc"->>'status' = 'pass')
);
ALTER TABLE "AnalyticalResult" ADD CONSTRAINT "AnalyticalResult_value_shape" CHECK (
  ("valueKind" = 'numeric' AND "numericInput" IS NOT NULL AND "textValue" IS NULL AND "codedValue" IS NULL)
  OR ("valueKind" = 'text' AND "textValue" IS NOT NULL AND "numericInput" IS NULL AND "numericValue" IS NULL AND "codedValue" IS NULL)
  OR ("valueKind" = 'coded' AND "codedValue" IS NOT NULL AND "numericInput" IS NULL AND "numericValue" IS NULL AND "textValue" IS NULL)
);
CREATE TRIGGER "ResultRevision_append_only" BEFORE UPDATE OR DELETE ON "ResultRevision" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
CREATE FUNCTION enforce_result_revision_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."version" = 1 AND NEW."previousRevisionId" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ResultRevision" p WHERE p."id" = NEW."previousRevisionId"
    AND p."resultId" = NEW."resultId" AND p."version" = NEW."version" - 1) THEN
    RAISE EXCEPTION 'Result revision must follow the previous version of the same result';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResultRevision_chain" BEFORE INSERT ON "ResultRevision" FOR EACH ROW EXECUTE FUNCTION enforce_result_revision_chain();
