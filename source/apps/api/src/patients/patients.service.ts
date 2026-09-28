import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Patient as PatientRow } from '@prisma/client';
import { PatientDemographicsSchema, type Patient, type PatientCommand, type SessionUser, type CommandResult } from '@labcopilot/contracts';
import { DatabaseService } from '../database';
import { digest } from '../auth/crypto';

function project(row: PatientRow): Patient {
  return { id: row.id, facilityId: row.facilityId, version: row.version,
    demographics: PatientDemographicsSchema.parse(row.demographics), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function revisionDemographics(value: Prisma.JsonValue, patientId: string) {
  // Early synthetic seeds included a duplicate record ID inside demographics.
  // Project that historical shape without mutating append-only evidence or
  // weakening validation for newly submitted patient commands.
  if (value && typeof value === 'object' && !Array.isArray(value) && value.id === patientId) {
    const { id: _legacyId, ...demographics } = value;
    return PatientDemographicsSchema.parse(demographics);
  }
  return PatientDemographicsSchema.parse(value);
}

@Injectable()
export class PatientsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async list(user: SessionUser): Promise<Patient[]> {
    return (await this.db.patient.findMany({ where: { facilityId: user.facilityId }, orderBy: { updatedAt: 'desc' }, take: 500 })).map(project);
  }
  async get(user: SessionUser, id: string): Promise<Patient> {
    const patient = await this.db.patient.findFirst({ where: { id, facilityId: user.facilityId } });
    if (!patient) throw new NotFoundException('Patient was not found in your facility.');
    return project(patient);
  }
  async history(user: SessionUser, id: string) {
    await this.get(user, id);
    const [revisions, audit] = await Promise.all([
      this.db.patientRevision.findMany({ where: { patientId: id }, orderBy: { version: 'desc' } }),
      this.db.auditEvent.findMany({ where: { facilityId: user.facilityId, entityId: id }, orderBy: { occurredAt: 'desc' } }),
    ]);
    return {
      revisions: revisions.map(row => ({ version: row.version, demographics: revisionDemographics(row.demographics, row.patientId), actorName: row.actorName, createdAt: row.createdAt.toISOString() })),
      audit: audit.map(row => ({ id: row.id, actorId: row.actorId, actorName: row.actorName, action: row.action, entityId: row.entityId, version: row.version, correlationId: row.correlationId, occurredAt: row.occurredAt.toISOString() })),
    };
  }
  async command(user: SessionUser, command: PatientCommand, correlationId: string): Promise<CommandResult> {
    if (command.kind === 'patient.create' && command.expectedVersion !== 0) throw new BadRequestException('A new patient must have expectedVersion 0.');
    if (command.kind === 'patient.update' && command.expectedVersion < 1) throw new BadRequestException('An update requires the accepted patient version.');
    const payloadHash = digest(JSON.stringify(command));
    try {
      return await this.db.$transaction(async tx => {
        // An operation lock serializes lost-response retries before looking up the
        // receipt. Separate command IDs still contend on the versioned patient row.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.id}:${command.operationId}`}, 0))`;
        const receipt = await tx.commandReceipt.findUnique({ where: { actorId_operationId: { actorId: user.id, operationId: command.operationId } } });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw new ConflictException('This operation ID was already used with different content.');
          const stored = receipt.result as unknown as CommandResult;
          if (stored.patient.facilityId !== user.facilityId) throw new NotFoundException('Patient was not found in your facility.');
          return { ...stored, replayed: true };
        }
        const existing = await tx.patient.findUnique({ where: { id: command.entityId } });
        if (existing && existing.facilityId !== user.facilityId) throw new NotFoundException('Patient was not found in your facility.');
        let patient: PatientRow;
        if (command.kind === 'patient.create') {
          if (existing) throw new ConflictException('A patient with this identity already exists.');
          patient = await tx.patient.create({ data: { id: command.entityId, facilityId: user.facilityId, version: 1, demographics: command.payload } });
        } else {
          if (!existing) throw new NotFoundException('Patient was not found in your facility.');
          const updated = await tx.patient.updateMany({ where: { id: command.entityId, facilityId: user.facilityId, version: command.expectedVersion }, data: { version: { increment: 1 }, demographics: command.payload } });
          if (updated.count !== 1) throw new ConflictException({ message: 'The server patient has changed. Review both versions before retrying.', code: 'VERSION_CONFLICT', currentVersion: (await tx.patient.findUniqueOrThrow({ where: { id: command.entityId } })).version });
          patient = await tx.patient.findUniqueOrThrow({ where: { id: command.entityId } });
        }
        await tx.patientRevision.create({ data: { patientId: patient.id, version: patient.version, demographics: command.payload, actorId: user.id, actorName: user.displayName } });
        await tx.auditEvent.create({ data: { facilityId: user.facilityId, actorId: user.id, actorName: user.displayName, action: command.kind, entityId: patient.id, version: patient.version, correlationId } });
        const result: CommandResult = { operationId: command.operationId, patient: project(patient), replayed: false };
        await tx.commandReceipt.create({ data: { actorId: user.id, operationId: command.operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue } });
        return result;
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (error) {
      // A simultaneous create using a different operation ID must not leak SQL or
      // become an internal error. A failed transaction leaves no partial audit.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A conflicting patient command was accepted. Refresh the patient before retrying.');
      throw error;
    }
  }
}
