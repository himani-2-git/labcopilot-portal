-- DropIndex
DROP INDEX "Accession_specimenId_key";

-- CreateIndex
CREATE INDEX "Accession_specimenId_idx" ON "Accession"("specimenId");
