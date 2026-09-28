import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SpecimenStatus as PrismaSpecimenStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  LaboratoryOrder, LaboratoryPanel, LaboratoryTest, OrderCommand, OrderCreatePayloadSchema,
  OrderHistory, SessionUser, Specimen, SpecimenCommand, SpecimenEvent, SpecimenStatus, SpecimenTransition,
  TestSpecimenType, WorkflowCommandResult,
} from '@labcopilot/contracts';
import { DatabaseService } from '../database';
import { digest } from '../auth/crypto';

type Tx = Prisma.TransactionClient;
const transitionMap: Record<SpecimenTransition, { from: SpecimenStatus[]; to: SpecimenStatus }> = {
  'specimen.create': { from: [], to: 'collection_pending' },
  'specimen.collect': { from: ['collection_pending'], to: 'collected' },
  'specimen.receive': { from: ['collected'], to: 'received_accession_pending' },
  'specimen.accept': { from: ['received_accession_pending'], to: 'accepted' },
  'specimen.reject': { from: ['received_accession_pending'], to: 'rejected' },
  'specimen.recollect': { from: ['rejected'], to: 'recollection_required' },
};
const toContractStatus = (value: PrismaSpecimenStatus): SpecimenStatus => value as SpecimenStatus;
// The full UUID is retained in new human-readable codes. Existing short demo
// codes remain stored and resolvable without relabeling historical records.
const specimenCode = (id: string) => `SPM-${id.replaceAll('-', '').toUpperCase()}`;
const accessionCode = (id: string) => `ACC-${id.replaceAll('-', '').toUpperCase()}`;
const orderInclude = {
  patient: true, orderedBy: true,
  items: { include: { test: true, panel: true, orderedTests: { orderBy: { sortOrder: 'asc' as const } } } },
  specimens: { include: { accessions: { orderBy: [{ receivedAt: 'desc' as const }, { id: 'desc' as const }], take: 1 } }, orderBy: { attemptNumber: 'desc' as const } },
} satisfies Prisma.LaboratoryOrderInclude;

function projectTest(row: { id: string; code: string; name: string; specimenType: string; unit: string | null; referenceMetadata: string | null; loincCode: string | null; status: 'active' | 'inactive' }): LaboratoryTest {
  return { id: row.id, code: row.code, name: row.name, specimenType: row.specimenType as TestSpecimenType, ...(row.unit ? { unit: row.unit } : {}), ...(row.referenceMetadata ? { referenceMetadata: row.referenceMetadata } : {}), ...(row.loincCode ? { loincCode: row.loincCode } : {}), status: row.status };
}
function projectPanel(row: { id: string; code: string; name: string; description: string | null; status: 'active' | 'inactive'; items: Array<{ id: string; sortOrder: number; test: { id: string; code: string; name: string; specimenType: string; unit: string | null; referenceMetadata: string | null; loincCode: string | null; status: 'active' | 'inactive' } }> }): LaboratoryPanel {
  return { id: row.id, code: row.code, name: row.name, ...(row.description ? { description: row.description } : {}), status: row.status, items: row.items.sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({ id: item.id, testId: item.test.id, testCode: item.test.code, testName: item.test.name, sortOrder: item.sortOrder })) };
}
function projectOrderedTest(row: { testId: string; testCode: string; testName: string; specimenType: string; unit: string | null; referenceMetadata: string | null; loincCode: string | null }): LaboratoryTest {
  return { id: row.testId, code: row.testCode, name: row.testName, specimenType: row.specimenType as TestSpecimenType,
    ...(row.unit ? { unit: row.unit } : {}), ...(row.referenceMetadata ? { referenceMetadata: row.referenceMetadata } : {}),
    ...(row.loincCode ? { loincCode: row.loincCode } : {}), status: 'active' };
}

@Injectable()
export class LaboratoryService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async listTests(): Promise<LaboratoryTest[]> {
    const rows = await this.db.laboratoryTest.findMany({ where: { status: 'active' }, orderBy: { code: 'asc' } });
    return rows.map(projectTest);
  }
  async listPanels(): Promise<LaboratoryPanel[]> {
    const rows = await this.db.laboratoryPanel.findMany({ where: { status: 'active' }, include: { items: { include: { test: true }, orderBy: { sortOrder: 'asc' } } }, orderBy: { code: 'asc' } });
    return rows.map(projectPanel);
  }
  private async orderRow(user: SessionUser, id: string, tx: Tx | DatabaseService = this.db) {
    const order = await tx.laboratoryOrder.findFirst({ where: { id, facilityId: user.facilityId }, include: orderInclude });
    if (!order) throw new NotFoundException('Order was not found in your facility.');
    return order;
  }
  private async specimenRow(user: SessionUser, id: string, tx: Tx | DatabaseService = this.db) {
    const specimen = await tx.specimen.findFirst({ where: { id, facilityId: user.facilityId }, include: { patient: true, order: true, accessions: { orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: 10 } } });
    if (!specimen) throw new NotFoundException('Specimen was not found in your facility.');
    return specimen;
  }
  private projectOrder(row: Awaited<ReturnType<LaboratoryService['orderRow']>>): LaboratoryOrder {
    const specimens = row.specimens.map(specimen => ({ id: specimen.id, attemptNumber: specimen.attemptNumber,
      status: toContractStatus(specimen.status), barcodeValue: specimen.barcodeValue,
      ...(specimen.accessions[0] ? { accessionIdentifier: specimen.accessions[0].identifier } : {}),
      createdAt: specimen.createdAt.toISOString(), ...(specimen.collectedAt ? { collectedAt: specimen.collectedAt.toISOString() } : {}),
      ...(specimen.receivedAt ? { receivedAt: specimen.receivedAt.toISOString() } : {}) }));
    return { id: row.id, facilityId: row.facilityId, patientId: row.patientId,
      patientName: row.patient.demographics && typeof row.patient.demographics === 'object' && 'displayName' in row.patient.demographics ? String((row.patient.demographics as Record<string, unknown>).displayName) : 'Demo patient',
      version: row.version, status: row.status, priority: row.priority, ...(row.note ? { note: row.note } : {}),
      orderedBy: row.orderedBy.displayName, ...(specimens[0] ? { specimen: specimens[0] } : {}), specimens,
      orderedAt: row.orderedAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      items: row.items.map(item => {
        if (item.itemType === 'test' && item.orderedTests[0]) return { id: item.id, itemType: 'test' as const, test: projectOrderedTest(item.orderedTests[0]) };
        if (item.itemType === 'panel' && item.panel) return { id: item.id, itemType: 'panel' as const,
          panel: { id: item.panel.id, code: item.catalogCode ?? item.panel.code, name: item.catalogName ?? item.panel.name,
            ...(item.panel.description ? { description: item.panel.description } : {}), status: 'active' as const,
            items: item.orderedTests.map(test => ({ id: test.id, testId: test.testId, testCode: test.testCode, testName: test.testName, sortOrder: test.sortOrder })) } };
        return { id: item.id, itemType: item.itemType };
      }) };
  }
  private projectSpecimen(row: Awaited<ReturnType<LaboratoryService['specimenRow']>>, matchedAccession?: (typeof row.accessions)[number], olderAttempt = false): Specimen {
    const accession = matchedAccession ?? row.accessions[0];
    // Before this migration a recollection reused one specimen row. For an
    // older accession on that legacy row, its own decision is the only reliable
    // physical-attempt state; the row's current status describes a later try.
    const olderLegacyAccession = matchedAccession && row.accessions[0]?.id !== matchedAccession.id;
    const displayedStatus: SpecimenStatus = olderLegacyAccession
      ? matchedAccession.decision === 'accepted' ? 'accepted'
        : matchedAccession.decision === 'rejected' ? 'rejected' : 'received_accession_pending'
      : toContractStatus(row.status);
    return { id: row.id, facilityId: row.facilityId, patientId: row.patientId,
      patientName: row.patient.demographics && typeof row.patient.demographics === 'object' && 'displayName' in row.patient.demographics ? String((row.patient.demographics as Record<string, unknown>).displayName) : 'Demo patient',
      orderId: row.orderId, attemptNumber: row.attemptNumber, version: row.version, specimenType: row.specimenType as TestSpecimenType,
      status: displayedStatus, barcodeValue: row.barcodeValue,
      ...(row.collectedAt ? { collectedAt: row.collectedAt.toISOString() } : {}), ...(row.collectedById ? { collectedBy: row.collectedById } : {}),
      ...(row.receivedAt ? { receivedAt: row.receivedAt.toISOString() } : {}), ...(row.receivedById ? { receivedBy: row.receivedById } : {}),
      ...(row.notes ? { notes: row.notes } : {}), ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
      ...(row.recollectionReason ? { recollectionReason: row.recollectionReason } : {}),
      ...(accession ? { accession: { id: accession.id, identifier: accession.identifier, barcodeValue: accession.barcodeValue,
        specimenId: accession.specimenId, orderId: accession.orderId, patientId: accession.patientId,
        ...(accession.receivedAt ? { receivedAt: accession.receivedAt.toISOString() } : {}),
        ...(accession.receivedById ? { receivedBy: accession.receivedById } : {}),
        ...(accession.decision ? { decision: accession.decision as 'accepted' | 'rejected' } : {}),
        ...(accession.rejectionReason ? { rejectionReason: accession.rejectionReason } : {}) } } : {}),
      ...(matchedAccession ? { lookupMatchedAccessionId: matchedAccession.id,
        lookupIsHistorical: olderAttempt || row.accessions[0]?.id !== matchedAccession.id } : {}),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async listOrders(user: SessionUser) { const rows = await this.db.laboratoryOrder.findMany({ where: { facilityId: user.facilityId }, include: orderInclude, orderBy: { orderedAt: 'desc' }, take: 500 }); return rows.map(row => this.projectOrder(row)); }
  async getOrder(user: SessionUser, id: string) { return this.projectOrder(await this.orderRow(user, id)); }
  async orderHistory(user: SessionUser, id: string): Promise<OrderHistory> {
    const order = await this.orderRow(user, id);
    const attemptIds = order.specimens.map(specimen => specimen.id);
    const [events, audit] = await Promise.all([
      this.db.specimenEvent.findMany({ where: { facilityId: user.facilityId, specimenId: { in: attemptIds } },
        include: { actor: true, specimen: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
      this.db.auditEvent.findMany({ where: { facilityId: user.facilityId, entityId: { in: [id, ...attemptIds] } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
    ]);
    return { events: events.map(row => ({ id: row.id, specimenId: row.specimenId, attemptNumber: row.specimen.attemptNumber,
      ...(row.fromStatus ? { fromStatus: toContractStatus(row.fromStatus) } : {}), toStatus: toContractStatus(row.toStatus),
      action: row.action, actorName: row.actor.displayName, ...(row.reason ? { reason: row.reason } : {}),
      occurredAt: row.occurredAt.toISOString(), correlationId: row.correlationId })),
      audit: audit.map(row => ({ id: row.id, actorId: row.actorId, actorName: row.actorName, action: row.action,
        entityId: row.entityId, version: row.version, correlationId: row.correlationId, occurredAt: row.occurredAt.toISOString() })) };
  }
  async listSpecimens(user: SessionUser) { const rows = await this.db.specimen.findMany({ where: { facilityId: user.facilityId }, include: { patient: true, order: true, accessions: { orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 500 }); return rows.map(row => this.projectSpecimen(row)); }
  async getSpecimen(user: SessionUser, id: string) { return this.projectSpecimen(await this.specimenRow(user, id)); }
  async lookupAccession(user: SessionUser, identifier: string) {
    const value = identifier.trim();
    const accession = await this.db.accession.findFirst({
      where: { facilityId: user.facilityId, OR: [{ identifier: value }, { barcodeValue: value }] },
    });
    if (accession) {
      const row = await this.specimenRow(user, accession.specimenId);
      const newest = await this.db.specimen.findFirst({ where: { orderId: row.orderId, facilityId: user.facilityId },
        orderBy: { attemptNumber: 'desc' }, select: { id: true } });
      return this.projectSpecimen(row, accession, newest?.id !== row.id);
    }
    const specimen = await this.db.specimen.findFirst({ where: { facilityId: user.facilityId, barcodeValue: value }, select: { id: true } });
    if (!specimen) throw new NotFoundException('Accession or specimen barcode was not found in your facility.');
    return this.getSpecimen(user, specimen.id);
  }
  async specimenHistory(user: SessionUser, id: string): Promise<{ events: SpecimenEvent[]; audit: OrderHistory['audit'] }> { await this.specimenRow(user, id); const [events, audit] = await Promise.all([this.db.specimenEvent.findMany({ where: { specimenId: id, facilityId: user.facilityId }, include: { actor: true }, orderBy: { occurredAt: 'asc' } }), this.db.auditEvent.findMany({ where: { facilityId: user.facilityId, entityId: id }, orderBy: { occurredAt: 'asc' } })]); return { events: events.map(row => ({ id: row.id, ...(row.fromStatus ? { fromStatus: toContractStatus(row.fromStatus) } : {}), toStatus: toContractStatus(row.toStatus), action: row.action, actorName: row.actor.displayName, ...(row.reason ? { reason: row.reason } : {}), occurredAt: row.occurredAt.toISOString(), correlationId: row.correlationId })), audit: audit.map(row => ({ id: row.id, actorId: row.actorId, actorName: row.actorName, action: row.action, entityId: row.entityId, version: row.version, correlationId: row.correlationId, occurredAt: row.occurredAt.toISOString() })) }; }

  private async ensureOrderItems(tx: Tx, payload: OrderCommand['payload']) {
    const parsed = OrderCreatePayloadSchema.parse(payload);
    const itemRows: Array<{ id: string; itemType: 'test' | 'panel'; testId?: string; panelId?: string;
      catalogCode: string; catalogName: string; orderedTests: Array<{ id: string; testId: string; sortOrder: number;
        testCode: string; testName: string; specimenType: string; unit: string | null;
        referenceMetadata: string | null; loincCode: string | null; analyticalPolicy?: Prisma.InputJsonValue }> }> = [];
    const specimenTypes = new Set<string>();
    const orderedTest = (test: { id: string; code: string; name: string; specimenType: string; unit: string | null;
      referenceMetadata: string | null; loincCode: string | null; analyticalPolicy: Prisma.JsonValue | null }, sortOrder: number) => ({
      id: randomUUID(), testId: test.id, sortOrder, testCode: test.code, testName: test.name,
      specimenType: test.specimenType, unit: test.unit, referenceMetadata: test.referenceMetadata, loincCode: test.loincCode,
      ...(test.analyticalPolicy !== null ? { analyticalPolicy: test.analyticalPolicy as Prisma.InputJsonValue } : {}),
    });
    for (const item of parsed.items) {
      if (item.testId) {
        const test = await tx.laboratoryTest.findFirst({ where: { id: item.testId, status: 'active' } });
        if (!test) throw new BadRequestException('The selected test is not active.');
        itemRows.push({ id: randomUUID(), itemType: 'test', testId: test.id, catalogCode: test.code,
          catalogName: test.name, orderedTests: [orderedTest(test, 1)] });
        specimenTypes.add(test.specimenType);
      }
      if (item.panelId) {
        const panel = await tx.laboratoryPanel.findFirst({ where: { id: item.panelId, status: 'active' },
          include: { items: { include: { test: true }, orderBy: { sortOrder: 'asc' } } } });
        if (!panel || !panel.items.length || panel.items.some(entry => entry.test.status !== 'active'))
          throw new BadRequestException('The selected panel is not active or has no active tests.');
        itemRows.push({ id: randomUUID(), itemType: 'panel', panelId: panel.id, catalogCode: panel.code,
          catalogName: panel.name, orderedTests: panel.items.map(entry => orderedTest(entry.test, entry.sortOrder)) });
        panel.items.forEach(entry => specimenTypes.add(entry.test.specimenType));
      }
    }
    if (specimenTypes.size !== 1) throw new BadRequestException('Phase 2 supports one specimen type per order. Choose tests from the same specimen workflow.');
    return { itemRows, specimenType: [...specimenTypes][0] };
  }
  async orderCommand(user: SessionUser, command: OrderCommand, correlationId: string): Promise<WorkflowCommandResult> {
    const payloadHash = digest(JSON.stringify(command));
    try { return await this.db.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.id}:${command.operationId}`}, 0))`; const receipt = await tx.commandReceipt.findUnique({ where: { actorId_operationId: { actorId: user.id, operationId: command.operationId } } }); if (receipt) { if (receipt.payloadHash !== payloadHash) throw new ConflictException('This operation ID was already used with different content.'); const stored = receipt.result as unknown as WorkflowCommandResult; if (stored.order?.facilityId !== user.facilityId) throw new NotFoundException('Order was not found in your facility.'); return { ...stored, replayed: true }; }
      const patient = await tx.patient.findFirst({ where: { id: command.payload.patientId, facilityId: user.facilityId } }); if (!patient) throw new NotFoundException('Patient was not found in your facility.'); const { itemRows } = await this.ensureOrderItems(tx, command.payload); const existing = await tx.laboratoryOrder.findUnique({ where: { id: command.entityId } }); if (existing) throw new ConflictException('An order with this identity already exists.'); const order = await tx.laboratoryOrder.create({ data: { id: command.entityId, facilityId: user.facilityId, patientId: patient.id, orderedById: user.id, version: 1, priority: command.payload.priority, note: command.payload.note, items: { create: itemRows.map(item => ({ id: item.id, itemType: item.itemType, catalogCode: item.catalogCode, catalogName: item.catalogName,
        ...(item.testId ? { testId: item.testId } : {}), ...(item.panelId ? { panelId: item.panelId } : {}),
        orderedTests: { create: item.orderedTests } })) } } }); await tx.auditEvent.create({ data: { facilityId: user.facilityId, actorId: user.id, actorName: user.displayName, action: 'order.create', entityId: order.id, version: order.version, correlationId } }); const result: WorkflowCommandResult = { operationId: command.operationId, order: this.projectOrder(await this.orderRow(user, order.id, tx)), replayed: false }; await tx.commandReceipt.create({ data: { actorId: user.id, operationId: command.operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue } }); return result; }, { maxWait: 10000, timeout: 15000 }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A conflicting order command was accepted. Refresh the order before retrying.'); throw error; }
  }

  async specimenCommand(user: SessionUser, command: SpecimenCommand, correlationId: string): Promise<WorkflowCommandResult> {
    const payloadHash = digest(JSON.stringify(command));
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.id}:${command.operationId}`}, 0))`;
        const receipt = await tx.commandReceipt.findUnique({ where: { actorId_operationId: { actorId: user.id, operationId: command.operationId } } });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw new ConflictException('This operation ID was already used with different content.');
          const stored = receipt.result as unknown as WorkflowCommandResult;
          if (stored.specimen?.facilityId !== user.facilityId) throw new NotFoundException('Specimen was not found in your facility.');
          return { ...stored, replayed: true };
        }

        if (command.kind === 'specimen.create') {
          if (command.expectedVersion !== 0) throw new ConflictException('Specimen creation requires expectedVersion 0.');
          if (!command.payload.orderId) throw new BadRequestException('A specimen must reference an order.');
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-specimen:${command.payload.orderId}`}, 0))`;
          const order = await tx.laboratoryOrder.findFirst({
            where: { id: command.payload.orderId, facilityId: user.facilityId },
            include: { items: { include: { orderedTests: true } } },
          });
          if (!order) throw new NotFoundException('Order was not found in your facility.');
          if (order.status !== 'ordered') throw new ConflictException('This order cannot receive a new specimen.');
          const current = await tx.specimen.findFirst({ where: { orderId: order.id }, orderBy: { attemptNumber: 'desc' } });
          if (current && current.status !== 'recollection_required')
            throw new ConflictException('This order already has an active specimen attempt. Complete its workflow first.');
          const types = new Set<string>();
          order.items.forEach(item => item.orderedTests.forEach(test => types.add(test.specimenType)));
          if (types.size !== 1) throw new BadRequestException('The order does not have one supported specimen type.');
          if (command.payload.specimenType && command.payload.specimenType !== [...types][0])
            throw new BadRequestException('Specimen type does not match the ordered test manifest.');
          const specimen = await tx.specimen.create({ data: {
            id: command.entityId, facilityId: user.facilityId, patientId: order.patientId, orderId: order.id, version: 1,
            attemptNumber: (current?.attemptNumber ?? 0) + 1, specimenType: [...types][0],
            status: 'collection_pending', barcodeValue: specimenCode(command.entityId), notes: command.payload.notes,
          } });
          await tx.specimenEvent.create({ data: { id: randomUUID(), facilityId: user.facilityId, specimenId: specimen.id, actorId: user.id, toStatus: 'collection_pending', action: 'specimen.create', correlationId } });
          await tx.auditEvent.create({ data: { facilityId: user.facilityId, actorId: user.id, actorName: user.displayName, action: 'specimen.create', entityId: specimen.id, version: specimen.version, correlationId } });
          const result: WorkflowCommandResult = { operationId: command.operationId, specimen: this.projectSpecimen(await this.specimenRow(user, specimen.id, tx)), replayed: false };
          await tx.commandReceipt.create({ data: { actorId: user.id, operationId: command.operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue } });
          return result;
        }

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`specimen:${command.entityId}`}, 0))`;
        const specimen = await tx.specimen.findFirst({ where: { id: command.entityId, facilityId: user.facilityId }, include: { accessions: { orderBy: { receivedAt: 'desc' }, take: 1 } } });
        if (!specimen) throw new NotFoundException('Specimen was not found in your facility.');
        const rule = transitionMap[command.kind];
        if (!rule.from.includes(toContractStatus(specimen.status))) throw new ConflictException({ message: `Cannot ${command.kind.replace('specimen.', '')} a specimen from ${specimen.status}.`, code: 'INVALID_SPECIMEN_TRANSITION', currentStatus: specimen.status });
        if (command.kind === 'specimen.reject' && !command.payload.reason) throw new BadRequestException('A rejection reason is required.');
        if (command.kind === 'specimen.recollect' && !command.payload.reason) throw new BadRequestException('A recollection reason is required.');
        if (command.expectedVersion !== specimen.version) throw new ConflictException({ message: 'The specimen has changed. Refresh before retrying.', code: 'VERSION_CONFLICT', currentVersion: specimen.version });

        const now = new Date();
        if (command.kind === 'specimen.receive') {
          if (specimen.accessions.length) throw new ConflictException('This specimen attempt already has an accession. Create a new physical specimen after recollection.');
          const identifier = accessionCode(specimen.id);
          await tx.accession.create({ data: { id: randomUUID(), facilityId: user.facilityId, identifier, barcodeValue: identifier, specimenId: specimen.id, orderId: specimen.orderId, patientId: specimen.patientId, receivedAt: now, receivedById: user.id } });
        }
        if (command.kind === 'specimen.accept' || command.kind === 'specimen.reject') {
          const latest = specimen.accessions[0];
          if (!latest) throw new ConflictException('A specimen must be received before a decision can be recorded.');
          await tx.accession.update({ where: { id: latest.id }, data: { decision: command.kind === 'specimen.accept' ? 'accepted' : 'rejected', ...(command.kind === 'specimen.reject' ? { rejectionReason: command.payload.reason } : {}) } });
        }
        const updated = await tx.specimen.update({ where: { id: specimen.id }, data: {
          version: { increment: 1 }, status: rule.to as PrismaSpecimenStatus,
          ...(command.kind === 'specimen.collect' ? { collectedAt: now, collectedById: user.id } : {}),
          ...(command.kind === 'specimen.receive' ? { receivedAt: now, receivedById: user.id } : {}),
          ...(command.kind === 'specimen.reject' ? { rejectionReason: command.payload.reason } : {}),
          ...(command.kind === 'specimen.recollect' ? { recollectionReason: command.payload.reason } : {}),
        } });
        await tx.specimenEvent.create({ data: { id: randomUUID(), facilityId: user.facilityId, specimenId: specimen.id, actorId: user.id, fromStatus: specimen.status, toStatus: rule.to as PrismaSpecimenStatus, action: command.kind, reason: command.payload.reason, correlationId } });
        await tx.auditEvent.create({ data: { facilityId: user.facilityId, actorId: user.id, actorName: user.displayName, action: command.kind, entityId: specimen.id, version: updated.version, correlationId } });
        const result: WorkflowCommandResult = { operationId: command.operationId, specimen: this.projectSpecimen(await this.specimenRow(user, specimen.id, tx)), replayed: false };
        await tx.commandReceipt.create({ data: { actorId: user.id, operationId: command.operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue } });
        return result;
      }, { maxWait: 10000, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A conflicting workflow command was accepted.');
      throw error;
    }
  }
}
