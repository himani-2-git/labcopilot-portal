-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('routine', 'urgent');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ordered', 'cancelled');

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('test', 'panel');

-- CreateEnum
CREATE TYPE "SpecimenStatus" AS ENUM ('ordered', 'collection_pending', 'collected', 'received_accession_pending', 'accepted', 'rejected', 'recollection_required');

-- CreateTable
CREATE TABLE "LaboratoryTest" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "unit" TEXT,
    "referenceMetadata" TEXT,
    "loincCode" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LaboratoryTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaboratoryPanel" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LaboratoryPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelItem" (
    "id" UUID NOT NULL,
    "panelId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PanelItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaboratoryOrder" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "orderedById" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'ordered',
    "priority" "OrderPriority" NOT NULL DEFAULT 'routine',
    "note" TEXT,
    "orderedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LaboratoryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaboratoryOrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "itemType" "OrderItemType" NOT NULL,
    "testId" UUID,
    "panelId" UUID,

    CONSTRAINT "LaboratoryOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specimen" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "specimenType" TEXT NOT NULL,
    "status" "SpecimenStatus" NOT NULL DEFAULT 'ordered',
    "barcodeValue" TEXT NOT NULL,
    "collectedAt" TIMESTAMPTZ(3),
    "collectedById" UUID,
    "receivedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "recollectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accession" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "barcodeValue" TEXT NOT NULL,
    "specimenId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "decision" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "Accession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecimenEvent" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "specimenId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromStatus" "SpecimenStatus",
    "toStatus" "SpecimenStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "correlationId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecimenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaboratoryTest_code_key" ON "LaboratoryTest"("code");

-- CreateIndex
CREATE INDEX "LaboratoryTest_status_specimenType_idx" ON "LaboratoryTest"("status", "specimenType");

-- CreateIndex
CREATE UNIQUE INDEX "LaboratoryPanel_code_key" ON "LaboratoryPanel"("code");

-- CreateIndex
CREATE INDEX "LaboratoryPanel_status_idx" ON "LaboratoryPanel"("status");

-- CreateIndex
CREATE INDEX "PanelItem_panelId_sortOrder_idx" ON "PanelItem"("panelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PanelItem_panelId_testId_key" ON "PanelItem"("panelId", "testId");

-- CreateIndex
CREATE INDEX "LaboratoryOrder_facilityId_orderedAt_idx" ON "LaboratoryOrder"("facilityId", "orderedAt");

-- CreateIndex
CREATE INDEX "LaboratoryOrder_patientId_orderedAt_idx" ON "LaboratoryOrder"("patientId", "orderedAt");

-- CreateIndex
CREATE INDEX "LaboratoryOrderItem_orderId_idx" ON "LaboratoryOrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_orderId_key" ON "Specimen"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_barcodeValue_key" ON "Specimen"("barcodeValue");

-- CreateIndex
CREATE INDEX "Specimen_facilityId_status_updatedAt_idx" ON "Specimen"("facilityId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Specimen_patientId_updatedAt_idx" ON "Specimen"("patientId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Accession_identifier_key" ON "Accession"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Accession_barcodeValue_key" ON "Accession"("barcodeValue");

-- CreateIndex
CREATE UNIQUE INDEX "Accession_specimenId_key" ON "Accession"("specimenId");

-- CreateIndex
CREATE INDEX "Accession_orderId_idx" ON "Accession"("orderId");

-- CreateIndex
CREATE INDEX "Accession_patientId_idx" ON "Accession"("patientId");

-- CreateIndex
CREATE INDEX "SpecimenEvent_facilityId_specimenId_occurredAt_idx" ON "SpecimenEvent"("facilityId", "specimenId", "occurredAt");

-- AddForeignKey
ALTER TABLE "PanelItem" ADD CONSTRAINT "PanelItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "LaboratoryPanel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelItem" ADD CONSTRAINT "PanelItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LaboratoryTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrder" ADD CONSTRAINT "LaboratoryOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrder" ADD CONSTRAINT "LaboratoryOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrder" ADD CONSTRAINT "LaboratoryOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrderItem" ADD CONSTRAINT "LaboratoryOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LaboratoryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrderItem" ADD CONSTRAINT "LaboratoryOrderItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LaboratoryTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrderItem" ADD CONSTRAINT "LaboratoryOrderItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "LaboratoryPanel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LaboratoryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accession" ADD CONSTRAINT "Accession_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accession" ADD CONSTRAINT "Accession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accession" ADD CONSTRAINT "Accession_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "SpecimenEvent_append_only" BEFORE UPDATE OR DELETE ON "SpecimenEvent" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();

-- AddForeignKey
ALTER TABLE "SpecimenEvent" ADD CONSTRAINT "SpecimenEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecimenEvent" ADD CONSTRAINT "SpecimenEvent_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecimenEvent" ADD CONSTRAINT "SpecimenEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
