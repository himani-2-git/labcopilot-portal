-- Phase 1 intentionally contains no clinical measurements, AI or reporting tables.
CREATE TYPE "Role" AS ENUM ('registration_clerk', 'technician', 'qualified_approver', 'administrator');
CREATE TABLE "Facility" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "facilityId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Session" (
  "id" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "csrfToken" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Patient" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "demographics" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Patient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Patient_version_positive" CHECK ("version" > 0),
  CONSTRAINT "Patient_synthetic_only" CHECK (COALESCE("demographics"->'synthetic' = 'true'::jsonb AND "demographics"->>'displayName' ~ '^Demo[[:space:]]+[^[:space:]]', false))
);
CREATE TABLE "PatientRevision" (
  "id" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "demographics" JSONB NOT NULL,
  "actorId" UUID NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientRevision_version_positive" CHECK ("version" > 0)
);
CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "correlationId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEvent_version_positive" CHECK ("version" > 0)
);
CREATE TABLE "CommandReceipt" (
  "id" UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_facilityId_idx" ON "User"("facilityId");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Patient_facilityId_updatedAt_idx" ON "Patient"("facilityId", "updatedAt");
CREATE UNIQUE INDEX "PatientRevision_patientId_version_key" ON "PatientRevision"("patientId", "version");
CREATE INDEX "AuditEvent_facilityId_entityId_occurredAt_idx" ON "AuditEvent"("facilityId", "entityId", "occurredAt");
CREATE UNIQUE INDEX "CommandReceipt_actorId_operationId_key" ON "CommandReceipt"("actorId", "operationId");
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRevision" ADD CONSTRAINT "PatientRevision_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRevision" ADD CONSTRAINT "PatientRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Append-oriented evidence. Runtime code cannot amend/delete prior audit/revisions.
-- Database owners can bypass triggers; deployment must use a non-owner runtime role.
CREATE FUNCTION prevent_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence records are append-only';
END;
$$;
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
CREATE TRIGGER "PatientRevision_append_only" BEFORE UPDATE OR DELETE ON "PatientRevision" FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
