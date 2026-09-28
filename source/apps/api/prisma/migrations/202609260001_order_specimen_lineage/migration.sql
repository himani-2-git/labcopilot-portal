-- Preserve existing specimen/accession/result rows. Earlier synthetic
-- recollections reused one specimen; their event and accession history stays
-- attached to that legacy row because past physical attempts cannot be
-- reconstructed reliably from the old model.
ALTER TABLE "Specimen" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "Specimen_orderId_key";
CREATE UNIQUE INDEX "Specimen_orderId_attemptNumber_key" ON "Specimen"("orderId", "attemptNumber");

ALTER TABLE "LaboratoryOrderItem" ADD COLUMN "catalogCode" TEXT;
ALTER TABLE "LaboratoryOrderItem" ADD COLUMN "catalogName" TEXT;
UPDATE "LaboratoryOrderItem" oi SET "catalogCode" = t."code", "catalogName" = t."name"
FROM "LaboratoryTest" t WHERE oi."testId" = t."id";
UPDATE "LaboratoryOrderItem" oi SET "catalogCode" = p."code", "catalogName" = p."name"
FROM "LaboratoryPanel" p WHERE oi."panelId" = p."id";

-- Freeze ordered test membership and demo rule inputs. Existing orders are
-- backfilled from the catalog as it exists at migration time; new orders take
-- their snapshot in the same transaction as order creation.
CREATE TABLE "LaboratoryOrderTest" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "testCode" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "unit" TEXT,
    "referenceMetadata" TEXT,
    "loincCode" TEXT,
    "analyticalPolicy" JSONB,
    CONSTRAINT "LaboratoryOrderTest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LaboratoryOrderTest_orderItemId_testId_key" ON "LaboratoryOrderTest"("orderItemId", "testId");
CREATE INDEX "LaboratoryOrderTest_orderItemId_sortOrder_idx" ON "LaboratoryOrderTest"("orderItemId", "sortOrder");
ALTER TABLE "LaboratoryOrderTest" ADD CONSTRAINT "LaboratoryOrderTest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "LaboratoryOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryOrderTest" ADD CONSTRAINT "LaboratoryOrderTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LaboratoryTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "LaboratoryOrderTest" ("id", "orderItemId", "testId", "sortOrder", "testCode", "testName", "specimenType", "unit", "referenceMetadata", "loincCode", "analyticalPolicy")
SELECT gen_random_uuid(), oi."id", t."id", 1, t."code", t."name", t."specimenType", t."unit", t."referenceMetadata", t."loincCode", t."analyticalPolicy"
FROM "LaboratoryOrderItem" oi JOIN "LaboratoryTest" t ON t."id" = oi."testId"
WHERE oi."itemType" = 'test';

INSERT INTO "LaboratoryOrderTest" ("id", "orderItemId", "testId", "sortOrder", "testCode", "testName", "specimenType", "unit", "referenceMetadata", "loincCode", "analyticalPolicy")
SELECT gen_random_uuid(), oi."id", t."id", pi."sortOrder", t."code", t."name", t."specimenType", t."unit", t."referenceMetadata", t."loincCode", t."analyticalPolicy"
FROM "LaboratoryOrderItem" oi JOIN "PanelItem" pi ON pi."panelId" = oi."panelId" JOIN "LaboratoryTest" t ON t."id" = pi."testId"
WHERE oi."itemType" = 'panel';

-- Preserve previously entered results even if a panel definition had been
-- edited before this migration. Result snapshots remain the evidence of the
-- policy actually used when those results were created.
INSERT INTO "LaboratoryOrderTest" ("id", "orderItemId", "testId", "sortOrder", "testCode", "testName", "specimenType", "unit", "referenceMetadata", "loincCode", "analyticalPolicy")
SELECT gen_random_uuid(), ar."orderItemId", t."id", COALESCE((SELECT MAX(m."sortOrder") + 1 FROM "LaboratoryOrderTest" m WHERE m."orderItemId" = ar."orderItemId"), 1),
       t."code", t."name", t."specimenType", t."unit", t."referenceMetadata", t."loincCode", ar."policy"
FROM (SELECT DISTINCT ON ("orderItemId", "testId") "orderItemId", "testId", "policy" FROM "AnalyticalResult" ORDER BY "orderItemId", "testId", "createdAt") ar
JOIN "LaboratoryTest" t ON t."id" = ar."testId"
ON CONFLICT ("orderItemId", "testId") DO NOTHING;

-- Order items and their expanded test/rule snapshots are evidence of what
-- was requested. Later catalog edits must never rewrite that evidence.
CREATE TRIGGER "LaboratoryOrderItem_append_only" BEFORE UPDATE OR DELETE ON "LaboratoryOrderItem" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
CREATE TRIGGER "LaboratoryOrderTest_append_only" BEFORE UPDATE OR DELETE ON "LaboratoryOrderTest" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
