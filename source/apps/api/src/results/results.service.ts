import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnalyticalResult, AnalyticalWorkItem, ResultCommand, ResultHistory, ResultPolicy, ResultQc, ResultValidation, ResultValue, SessionUser, WorkflowCommandResult } from '@labcopilot/contracts';
import { DatabaseService } from '../database';
import { digest } from '../auth/crypto';
import { exactDecimal, validateResult } from './rules';

type Tx = Prisma.TransactionClient;
const include = { patient: true, test: true, accession: true,
  orderItem: { include: { orderedTests: true } } } satisfies Prisma.AnalyticalResultInclude;
type Row = Prisma.AnalyticalResultGetPayload<{ include: typeof include }>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const freshValidation = (): ResultValidation => ({ outcome: 'not_run', issues: [], flag: 'not_evaluated', critical: 'not_evaluated' });
function valueData(value: ResultValue) {
  return { valueKind: value.kind, numericInput: value.kind === 'numeric' ? value.value : null,
    numericValue: value.kind === 'numeric' ? exactDecimal(value.value) : null,
    textValue: value.kind === 'text' ? value.value : null, codedValue: value.kind === 'coded' ? value.value : null, unit: value.unit ?? null };
}
function policyOf(value: Prisma.JsonValue | null): ResultPolicy {
  const policy = value as unknown as ResultPolicy | null;
  if (!policy || policy.synthetic !== true || !policy.version || !['numeric', 'text', 'coded'].includes(policy.valueKind)) throw new BadRequestException('This test has no supported synthetic analytical policy.');
  for (const bound of [policy.lower, policy.upper, policy.criticalLower, policy.criticalUpper]) if (bound !== undefined && !exactDecimal(bound)) throw new BadRequestException('Synthetic rule configuration contains an invalid decimal.');
  for (const [low, high] of [[policy.lower, policy.upper], [policy.criticalLower, policy.lower], [policy.upper, policy.criticalUpper], [policy.criticalLower, policy.criticalUpper]]) {
    if (low !== undefined && high !== undefined && exactDecimal(low)!.greaterThan(exactDecimal(high)!)) throw new BadRequestException('Synthetic rule bounds are inconsistent.');
  }
  if (typeof policy.label !== 'string' || (policy.expectedUnit !== undefined && typeof policy.expectedUnit !== 'string')
    || (policy.allowedValues !== undefined && (!Array.isArray(policy.allowedValues) || !policy.allowedValues.length || policy.allowedValues.some(value => typeof value !== 'string')))
    || (policy.expectedValue !== undefined && typeof policy.expectedValue !== 'string')
    || (policy.valueKind === 'coded' && (!policy.allowedValues || (policy.expectedValue !== undefined && !policy.allowedValues.includes(policy.expectedValue))))) {
    throw new BadRequestException('Synthetic analytical policy is incomplete or invalid.');
  }
  return policy;
}
function patientName(value: Prisma.JsonValue): string {
  return value && typeof value === 'object' && 'displayName' in value ? String(value.displayName) : 'Demo patient';
}
function project(row: Row): AnalyticalResult {
  const orderedTest = row.orderItem.orderedTests.find(test => test.testId === row.testId);
  return { id: row.id, facilityId: row.facilityId, patientId: row.patientId, patientName: patientName(row.patient.demographics),
    orderId: row.orderId, orderItemId: row.orderItemId, testId: row.testId,
    testCode: orderedTest?.testCode ?? row.test.code, testName: orderedTest?.testName ?? row.test.name,
    specimenId: row.specimenId, accessionId: row.accessionId, accessionIdentifier: row.accession.identifier,
    version: row.version, status: row.status,
    value: { kind: row.valueKind, value: row.numericInput ?? row.textValue ?? row.codedValue ?? '', ...(row.unit !== null ? { unit: row.unit } : {}) },
    policy: policyOf(row.policy), validation: row.validation as unknown as ResultValidation, qc: row.qc as unknown as ResultQc,
    readiness: row.readiness as AnalyticalResult['readiness'], criticalReviewRequired: row.criticalReviewRequired,
    ...(row.enteredBy ? { enteredBy: row.enteredBy } : {}), ...(row.enteredAt ? { enteredAt: row.enteredAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class ResultsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private async row(user: SessionUser, id: string, tx: Tx | DatabaseService = this.db): Promise<Row> {
    const row = await tx.analyticalResult.findFirst({ where: { id, facilityId: user.facilityId }, include });
    if (!row) throw new NotFoundException('Result was not found in your facility.');
    return row;
  }
  async get(user: SessionUser, id: string) { return project(await this.row(user, id)); }
  async list(user: SessionUser) { return (await this.db.analyticalResult.findMany({ where: { facilityId: user.facilityId }, include, orderBy: { updatedAt: 'desc' }, take: 500 })).map(project); }
  async history(user: SessionUser, id: string): Promise<ResultHistory> {
    await this.row(user, id);
    const [revisions, audit] = await Promise.all([
      this.db.resultRevision.findMany({ where: { resultId: id }, orderBy: { version: 'desc' } }),
      this.db.auditEvent.findMany({ where: { entityId: id, facilityId: user.facilityId }, orderBy: { occurredAt: 'desc' } }),
    ]);
    return { revisions: revisions.map(row => ({ id: row.id, resultId: row.resultId, version: row.version,
      ...(row.version > 1 ? { previousVersion: row.version - 1 } : {}), action: row.action, actorId: row.actorId, actorName: row.actorName,
      ...(row.reason ? { reason: row.reason } : {}), createdAt: row.createdAt.toISOString(), snapshot: row.snapshot as unknown as AnalyticalResult })),
      audit: audit.map(row => ({ ...row, occurredAt: row.occurredAt.toISOString() })) };
  }
  async worklist(user: SessionUser): Promise<AnalyticalWorkItem[]> {
    const specimens = await this.db.specimen.findMany({ where: { facilityId: user.facilityId, status: 'accepted' },
      include: { patient: true, accessions: { orderBy: { receivedAt: 'desc' }, take: 1 }, results: { include },
        order: { include: { items: { include: { orderedTests: { orderBy: { sortOrder: 'asc' } } } } } } },
      orderBy: { updatedAt: 'desc' }, take: 500 });
    const items: AnalyticalWorkItem[] = [];
    for (const specimen of specimens) {
      const accession = specimen.accessions[0];
      if (!accession || accession.decision !== 'accepted' || specimen.order.status !== 'ordered' || specimen.patient.facilityId !== user.facilityId) continue;
      for (const orderItem of specimen.order.items) {
        for (const test of orderItem.orderedTests) {
          if (!test.analyticalPolicy) continue;
          const result = specimen.results.find(row => row.orderItemId === orderItem.id && row.testId === test.testId && row.accessionId === accession.id);
          items.push({ specimenId: specimen.id, specimenBarcode: specimen.barcodeValue, accessionId: accession.id,
            accessionIdentifier: accession.identifier, patientId: specimen.patientId, patientName: patientName(specimen.patient.demographics),
            orderId: specimen.orderId, orderItemId: orderItem.id, testId: test.testId, testCode: test.testCode, testName: test.testName,
            policy: result ? policyOf(result.policy) : policyOf(test.analyticalPolicy), ...(result ? { result: project(result) } : {}) });
        }
      }
    }
    return items;
  }
  private async accepted(tx: Tx, user: SessionUser, specimenId: string, accessionId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`specimen:${specimenId}`}, 0))`;
    const specimen = await tx.specimen.findFirst({ where: { id: specimenId, facilityId: user.facilityId },
      include: { patient: true, order: true, accessions: { orderBy: { receivedAt: 'desc' }, take: 1 } } });
    if (!specimen || specimen.patient.facilityId !== user.facilityId || specimen.order.facilityId !== user.facilityId) throw new NotFoundException('Specimen was not found in your facility.');
    const accession = specimen.accessions[0];
    if (specimen.status !== 'accepted' || specimen.order.status !== 'ordered' || !accession || accession.id !== accessionId || accession.decision !== 'accepted')
      throw new ConflictException({ message: 'Results require the current accepted specimen and accession.', code: 'SPECIMEN_NOT_ACCEPTED' });
    if (accession.facilityId !== user.facilityId || accession.orderId !== specimen.orderId || accession.patientId !== specimen.patientId) throw new ConflictException('Accession linkage is inconsistent.');
    return specimen;
  }
  async command(user: SessionUser, command: ResultCommand, correlationId: string): Promise<WorkflowCommandResult> {
    if (!user.permissions.includes('result:write')) throw new ForbiddenException('Result-entry permission is required.');
    const payloadHash = digest(JSON.stringify(command));
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.id}:${command.operationId}`}, 0))`;
        const receipt = await tx.commandReceipt.findUnique({ where: { actorId_operationId: { actorId: user.id, operationId: command.operationId } } });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw new ConflictException('This operation ID was already used with different content.');
          const stored = receipt.result as unknown as WorkflowCommandResult;
          if (stored.result?.facilityId !== user.facilityId) throw new NotFoundException('Result was not found in your facility.');
          return { ...stored, replayed: true };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`result:${command.entityId}`}, 0))`;
        let previousRevisionId: string | undefined;
        if (command.kind === 'result.create') {
          const specimen = await this.accepted(tx, user, command.payload.specimenId, command.payload.accessionId);
          const item = await tx.laboratoryOrderItem.findFirst({ where: { id: command.payload.orderItemId, orderId: specimen.orderId } });
          if (!item) throw new BadRequestException('Test must belong to this specimen order item.');
          const orderedTest = await tx.laboratoryOrderTest.findUnique({ where: { orderItemId_testId: {
            orderItemId: item.id, testId: command.payload.testId } } });
          if (!orderedTest) throw new BadRequestException('Test must belong to the frozen order manifest.');
          if (orderedTest.specimenType !== specimen.specimenType) throw new ConflictException('Ordered test and specimen types do not match.');
          const policy = policyOf(orderedTest.analyticalPolicy);
          await tx.analyticalResult.create({ data: { id: command.entityId, facilityId: user.facilityId, patientId: specimen.patientId,
            orderId: specimen.orderId, orderItemId: item.id, testId: orderedTest.testId, specimenId: specimen.id, accessionId: command.payload.accessionId,
            version: 1, ...valueData(command.payload.value), policy: json(policy), validation: json(freshValidation()), qc: json({ status: 'missing' }) } });
        } else {
          const current = await this.row(user, command.entityId, tx);
          if (current.version !== command.expectedVersion) throw new ConflictException({ message: 'Result has changed. Refresh and reconcile the saved revision.', code: 'VERSION_CONFLICT', currentVersion: current.version });
          await this.accepted(tx, user, current.specimenId, current.accessionId);
          const state = project(current);
          const allowed: Record<Exclude<ResultCommand['kind'], 'result.create'>, AnalyticalResult['status'][]> = {
            'result.revise': ['draft', 'entered', 'validated', 'analytically_ready'], 'result.enter': ['draft'],
            'result.validate': ['entered', 'validated'], 'result.qc': ['entered', 'validated', 'analytically_ready'], 'result.readiness': ['validated'],
          };
          if (!allowed[command.kind].includes(state.status)) throw new ConflictException({ message: `Cannot ${command.kind.slice(7)} a ${state.status} result.`, code: 'INVALID_RESULT_TRANSITION' });
          const data: Prisma.AnalyticalResultUpdateInput = { version: { increment: 1 } };
          const now = new Date();
          if (command.kind === 'result.revise') Object.assign(data, valueData(command.payload.value), { status: 'draft', validation: json(freshValidation()),
            qc: json({ status: 'missing' }), readiness: 'pending', criticalReviewRequired: false, enteredBy: null, enteredAt: null });
          if (command.kind === 'result.enter') Object.assign(data, { status: 'entered', enteredBy: user.displayName, enteredAt: now });
          if (command.kind === 'result.validate') {
            const validation = validateResult(state.value, state.policy, now.toISOString());
            Object.assign(data, { validation: json(validation), status: validation.outcome === 'passed' ? 'validated' : 'entered',
              readiness: validation.outcome === 'passed' && state.qc.status !== 'fail' ? 'pending' : 'blocked', criticalReviewRequired: ['low', 'high'].includes(validation.critical) });
          }
          if (command.kind === 'result.qc') {
            Object.assign(data, { qc: json({ status: command.payload.status, reason: command.payload.reason, checkedBy: user.displayName, checkedAt: now.toISOString() }),
              readiness: command.payload.status === 'fail' ? 'blocked' : state.status === 'analytically_ready' ? 'ready' : state.validation.outcome === 'failed' ? 'blocked' : 'pending',
              ...(command.payload.status === 'fail' && state.status === 'analytically_ready' ? { status: 'validated' } : {}) });
          }
          if (command.kind === 'result.readiness') Object.assign(data, state.validation.outcome === 'passed' && state.qc.status === 'pass'
            ? { status: 'analytically_ready', readiness: 'ready' } : { readiness: 'blocked' });
          previousRevisionId = (await tx.resultRevision.findUniqueOrThrow({ where: { resultId_version: { resultId: current.id, version: current.version } } })).id;
          await tx.analyticalResult.update({ where: { id: current.id }, data });
        }
        const row = await this.row(user, command.entityId, tx);
        const snapshot = project(row);
        await tx.resultRevision.create({ data: { resultId: row.id, version: row.version, previousRevisionId,
          action: command.kind, actorId: user.id, actorName: user.displayName, ...('reason' in command.payload ? { reason: command.payload.reason } : {}),
          valueKind: row.valueKind, numericValue: row.numericValue, snapshot: json(snapshot) } });
        const actions = [command.kind as string];
        if (command.kind === 'result.validate') {
          actions.push(`result.validation.${snapshot.validation.outcome}`, `result.classification.${snapshot.validation.flag}`);
          if (snapshot.criticalReviewRequired) actions.push(`result.critical.${snapshot.validation.critical}`);
        }
        if (command.kind === 'result.readiness') actions.push(`result.readiness.${snapshot.readiness}`);
        await tx.auditEvent.createMany({ data: actions.map(action => ({ facilityId: user.facilityId, actorId: user.id, actorName: user.displayName,
          action, entityId: row.id, version: row.version, correlationId })) });
        const result: WorkflowCommandResult = { operationId: command.operationId, result: snapshot, replayed: false };
        await tx.commandReceipt.create({ data: { actorId: user.id, operationId: command.operationId, payloadHash, result: json(result) } });
        return result;
      }, { maxWait: 10000, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A result already exists for this accession, order item and test. Refresh the worklist.');
      throw error;
    }
  }
}
