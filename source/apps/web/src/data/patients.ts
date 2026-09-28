import Dexie, { type Table } from 'dexie';
import {
  PatientDemographicsSchema,
  ResultCommandSchema,
  type AnalyticalResult,
  type AnalyticalWorkItem,
  type AuthSession,
  type CommandResult,
  type LaboratoryPanel,
  type LaboratoryTest,
  type OrderCommand,
  type Patient,
  type PatientCommand,
  type PatientDemographics,
  type Permission,
  type ResultDraftCommand,
  type SpecimenCommand,
  type WorkflowCommandResult,
} from '@labcopilot/contracts';
import { api, ApiError } from '../lib/api';

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rejected';

export interface LocalPatient extends Patient {
  /** Accepted server revision, separate from the optimistic local revision. */
  serverVersion: number;
  syncStatus: SyncStatus;
  syncError?: string;
}

interface StoredPatient extends LocalPatient {
  userId: string;
  serverSnapshot?: Patient;
}

export interface QueuedPatientCommand {
  operationId: string;
  entityId: string;
  userId: string;
  facilityId: string;
  command: PatientCommand;
  status: 'pending' | 'conflict' | 'rejected';
  createdAt: string;
  lastError?: string;
  attempts: number;
}

export type PreAnalyticalCommand = OrderCommand | SpecimenCommand;
export type WorkflowCommand = PreAnalyticalCommand | ResultDraftCommand;

export interface QueuedWorkflowCommand {
  operationId: string;
  entityId: string;
  userId: string;
  facilityId: string;
  command: WorkflowCommand;
  status: 'pending' | 'conflict' | 'rejected';
  createdAt: string;
  lastError?: string;
  attempts: number;
}

interface CachedCatalog {
  userId: string;
  facilityId: string;
  tests: LaboratoryTest[];
  panels: LaboratoryPanel[];
  updatedAt: string;
}

interface CachedResult { userId: string; facilityId: string; id: string; result: AnalyticalResult }
interface CachedAnalyticalWorklist { userId: string; facilityId: string; items: AnalyticalWorkItem[]; updatedAt: string }
const workflowPermission = (command: WorkflowCommand): Permission => command.kind.startsWith('result.')
  ? 'result:write' : command.kind === 'order.create' ? 'order:write' : 'specimen:write';

class PatientDatabase extends Dexie {
  patients!: Table<StoredPatient, [string, string, string]>;
  commands!: Table<QueuedPatientCommand, [string, string, string]>;
  workflowCommands!: Table<QueuedWorkflowCommand, [string, string, string]>;
  catalog!: Table<CachedCatalog, [string, string]>;
  results!: Table<CachedResult, [string, string, string]>;
  analyticalWorklist!: Table<CachedAnalyticalWorklist, [string, string]>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      patients: '[userId+facilityId+id], [userId+facilityId]',
      commands: '[userId+facilityId+operationId], [userId+facilityId], [userId+facilityId+entityId]',
    });
    this.version(2).stores({
      patients: '[userId+facilityId+id], [userId+facilityId]',
      commands: '[userId+facilityId+operationId], [userId+facilityId], [userId+facilityId+entityId]',
      workflowCommands: '[userId+facilityId+operationId], [userId+facilityId], [userId+facilityId+entityId]',
      catalog: '[userId+facilityId]',
    });
    this.version(3).stores({
      results: '[userId+facilityId+id], [userId+facilityId]',
      analyticalWorklist: '[userId+facilityId]',
    });
  }
}

export class SessionLockedError extends Error {
  constructor(message = 'This workspace is locked. Sign in online again to recover your saved drafts.') {
    super(message);
    this.name = 'SessionLockedError';
  }
}

export interface FlushResult { accepted: number; remaining: number; blocked: number }
interface StoreOptions {
  name?: string;
  now?: () => number;
  uuid?: () => string;
  send?: (command: PatientCommand, session: AuthSession) => Promise<CommandResult>;
  sendWorkflow?: (command: WorkflowCommand, session: AuthSession) => Promise<WorkflowCommandResult>;
}
interface Scope { userId: string; facilityId: string; generation: number }

// Web Locks provides cross-tab coordination where supported. This fallback only
// serializes callers in this JS context; server idempotency is still mandatory.
const activeFlushes = new Map<string, Promise<unknown>>();
async function coordinated<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(key, work);
  }
  const previous = activeFlushes.get(key);
  const next = (previous ?? Promise.resolve()).catch(() => undefined).then(work);
  activeFlushes.set(key, next);
  try { return await next; }
  finally { if (activeFlushes.get(key) === next) activeFlushes.delete(key); }
}

const publicPatient = (row: StoredPatient): LocalPatient => {
  const { userId: _userId, serverSnapshot: _serverSnapshot, ...patient } = row;
  return patient;
};
const orderCommands = (rows: QueuedPatientCommand[]) => rows.sort((a, b) =>
  a.command.expectedVersion - b.command.expectedVersion || a.createdAt.localeCompare(b.createdAt)
  || a.operationId.localeCompare(b.operationId));
const orderWorkflowCommands = (rows: QueuedWorkflowCommand[]) => rows.sort((a, b) =>
  a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId));

/** Limited patient draft persistence and manual push, not a two-way sync engine. */
export class PatientStore {
  private readonly db: PatientDatabase;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly send: NonNullable<StoreOptions['send']>;
  private readonly sendWorkflow: NonNullable<StoreOptions['sendWorkflow']>;
  private session?: AuthSession;
  private generation = 0;

  constructor(options: StoreOptions = {}) {
    this.db = new PatientDatabase(options.name ?? 'labcopilot-phase1');
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.send = options.send ?? api.submitPatient;
    this.sendWorkflow = options.sendWorkflow ?? ((command, session) => {
      if (command.kind === 'result.create' || command.kind === 'result.revise') return api.submitResult(command, session);
      return command.kind === 'order.create' ? api.submitOrder(command, session) : api.submitSpecimen(command, session);
    });
  }

  unlock(session: AuthSession): void {
    this.lock();
    if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= this.now()) {
      throw new SessionLockedError('Your session has expired. Sign in online to unlock your saved drafts.');
    }
    this.session = structuredClone(session);
  }

  lock(): void { this.session = undefined; this.generation += 1; }
  close(): void { this.lock(); this.db.close(); }

  private scope(permission: Permission = 'patient:read'): Scope {
    const session = this.session;
    if (!session || Date.parse(session.expiresAt) <= this.now()) {
      this.lock();
      throw new SessionLockedError();
    }
    if (!session.user.permissions.includes(permission)) {
      throw new ApiError(403, 'Your current role does not permit this patient action.', 'FORBIDDEN');
    }
    return { userId: session.user.id, facilityId: session.user.facilityId, generation: this.generation };
  }

  private assertScope(scope: Scope): void {
    const current = this.scope();
    if (current.generation !== scope.generation || current.userId !== scope.userId || current.facilityId !== scope.facilityId) {
      throw new SessionLockedError();
    }
  }

  private assertSession(scope: Scope, session: AuthSession): void {
    this.assertScope(scope);
    if (session.user.id !== scope.userId || session.user.facilityId !== scope.facilityId
      || session.csrfToken !== this.session?.csrfToken || !Number.isFinite(Date.parse(session.expiresAt))
      || Date.parse(session.expiresAt) <= this.now()) {
      throw new SessionLockedError('Only the original signed-in session can access this workspace’s saved commands.');
    }
  }

  private rows(scope: Scope, entityId: string) {
    return this.db.commands.where('[userId+facilityId+entityId]').equals([scope.userId, scope.facilityId, entityId]).toArray();
  }

  async list(): Promise<LocalPatient[]> {
    const scope = this.scope();
    const rows = await this.db.patients.where('[userId+facilityId]').equals([scope.userId, scope.facilityId]).toArray();
    this.assertScope(scope);
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicPatient);
  }

  async get(id: string): Promise<LocalPatient | undefined> {
    const scope = this.scope();
    const row = await this.db.patients.get([scope.userId, scope.facilityId, id]);
    this.assertScope(scope);
    return row ? publicPatient(row) : undefined;
  }

  async outbox(): Promise<QueuedPatientCommand[]> {
    const scope = this.scope();
    const rows = await this.db.commands.where('[userId+facilityId]').equals([scope.userId, scope.facilityId]).toArray();
    this.assertScope(scope);
    return orderCommands(rows);
  }

  async workflowOutbox(): Promise<QueuedWorkflowCommand[]> {
    const scope = this.scope();
    const rows = await this.db.workflowCommands.where('[userId+facilityId]').equals([scope.userId, scope.facilityId]).toArray();
    this.assertScope(scope);
    return orderWorkflowCommands(rows);
  }

  async cacheCatalog(tests: LaboratoryTest[], panels: LaboratoryPanel[], session: AuthSession): Promise<void> {
    const scope = this.scope('catalog:read');
    this.assertSession(scope, session);
    await this.db.catalog.put({
      userId: scope.userId,
      facilityId: scope.facilityId,
      tests: structuredClone(tests),
      panels: structuredClone(panels),
      updatedAt: new Date(this.now()).toISOString(),
    });
    this.assertScope(scope);
  }

  async cachedCatalog(): Promise<{ tests: LaboratoryTest[]; panels: LaboratoryPanel[]; updatedAt: string } | undefined> {
    const scope = this.scope('catalog:read');
    const row = await this.db.catalog.get([scope.userId, scope.facilityId]);
    this.assertScope(scope);
    return row ? { tests: structuredClone(row.tests), panels: structuredClone(row.panels), updatedAt: row.updatedAt } : undefined;
  }

  async cacheAnalyticalWorklist(items: AnalyticalWorkItem[], session: AuthSession): Promise<void> {
    const scope = this.scope('result:read');
    this.assertSession(scope, session);
    if (items.some(item => item.result && item.result.facilityId !== scope.facilityId)) {
      throw new ApiError(403, 'The analytical working set is outside your facility.', 'FACILITY_MISMATCH');
    }
    await this.db.transaction('rw', this.db.analyticalWorklist, this.db.results, async () => {
      this.assertScope(scope);
      await this.db.analyticalWorklist.put({ userId: scope.userId, facilityId: scope.facilityId,
        items: structuredClone(items), updatedAt: new Date(this.now()).toISOString() });
      for (const item of items) if (item.result) await this.putResult(scope, item.result);
      this.assertScope(scope);
    });
  }

  async cachedAnalyticalWorklist(): Promise<{ items: AnalyticalWorkItem[]; updatedAt: string } | undefined> {
    const scope = this.scope('result:read');
    const row = await this.db.analyticalWorklist.get([scope.userId, scope.facilityId]);
    this.assertScope(scope);
    return row ? { items: structuredClone(row.items), updatedAt: row.updatedAt } : undefined;
  }

  private async putResult(scope: Scope, result: AnalyticalResult): Promise<void> {
    if (result.facilityId !== scope.facilityId) throw new ApiError(403, 'The result is outside your facility.', 'FACILITY_MISMATCH');
    const existing = await this.db.results.get([scope.userId, scope.facilityId, result.id]);
    if (!existing || existing.result.version <= result.version) {
      await this.db.results.put({ userId: scope.userId, facilityId: scope.facilityId, id: result.id, result: structuredClone(result) });
    }
  }

  async cacheResult(result: AnalyticalResult, session: AuthSession): Promise<void> {
    const scope = this.scope('result:read');
    this.assertSession(scope, session);
    await this.db.transaction('rw', this.db.results, async () => {
      this.assertScope(scope); await this.putResult(scope, result); this.assertScope(scope);
    });
  }

  async cachedResult(id: string): Promise<AnalyticalResult | undefined> {
    const scope = this.scope('result:read');
    const row = await this.db.results.get([scope.userId, scope.facilityId, id]);
    this.assertScope(scope);
    return row ? structuredClone(row.result) : undefined;
  }

  async queueWorkflow(command: WorkflowCommand): Promise<QueuedWorkflowCommand> {
    // Enforce the offline boundary even if a caller bypasses TypeScript/UI controls.
    if (command.kind.startsWith('result.')) {
      const parsed = ResultCommandSchema.parse(command);
      if (parsed.kind !== 'result.create' && parsed.kind !== 'result.revise') {
        throw new Error('Only result drafts can be queued. Validation, QC and readiness require the server.');
      }
    }
    const permission = workflowPermission(command);
    const scope = this.scope(permission);
    const row: QueuedWorkflowCommand = {
      operationId: command.operationId,
      entityId: command.entityId,
      userId: scope.userId,
      facilityId: scope.facilityId,
      command: structuredClone(command),
      status: 'pending',
      createdAt: new Date(this.now()).toISOString(),
      attempts: 0,
    };
    await this.db.transaction('rw', this.db.workflowCommands, async () => {
      this.assertScope(scope);
      if (command.kind.startsWith('result.')) {
        const existing = await this.db.workflowCommands.where('[userId+facilityId+entityId]')
          .equals([scope.userId, scope.facilityId, command.entityId]).count();
        if (existing) throw new Error('This result already has a saved draft. Submit or reconcile that command before another correction.');
        if (command.kind === 'result.create') {
          const scoped = await this.db.workflowCommands.where('[userId+facilityId]').equals([scope.userId, scope.facilityId]).toArray();
          if (scoped.some(item => item.command.kind === 'result.create'
            && item.command.payload.accessionId === command.payload.accessionId
            && item.command.payload.orderItemId === command.payload.orderItemId
            && item.command.payload.testId === command.payload.testId)) {
            throw new Error('A draft for this accession and test is already saved on this device.');
          }
        }
      }
      await this.db.workflowCommands.add(row);
      this.assertScope(scope);
    });
    this.assertScope(scope);
    return row;
  }

  async save(demographics: PatientDemographics, id?: string): Promise<LocalPatient> {
    const scope = this.scope('patient:write');
    const payload = PatientDemographicsSchema.parse(demographics);
    const entityId = id ?? this.uuid();
    const saved = await this.db.transaction('rw', this.db.patients, this.db.commands, async () => {
      this.assertScope(scope);
      const current = await this.db.patients.get([scope.userId, scope.facilityId, entityId]);
      if (id && !current) throw new Error('This patient is not available in your unlocked workspace. Refresh the patient list online.');
      if (current?.syncStatus === 'conflict' || current?.syncStatus === 'rejected') {
        throw new Error('This draft needs reconciliation before more edits. Its saved contents have been preserved.');
      }
      const timestamp = new Date(this.now()).toISOString();
      const operationId = this.uuid();
      const command: PatientCommand = {
        protocolVersion: 1,
        operationId,
        entityId,
        expectedVersion: current?.version ?? 0,
        kind: current ? 'patient.update' : 'patient.create',
        payload,
      };
      const patient: StoredPatient = {
        ...current,
        id: entityId,
        userId: scope.userId,
        facilityId: scope.facilityId,
        version: command.expectedVersion + 1,
        demographics: payload,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        serverVersion: current?.serverVersion ?? 0,
        syncStatus: 'pending',
        syncError: undefined,
      };
      await this.db.patients.put(patient);
      await this.db.commands.add({
        operationId, entityId, userId: scope.userId, facilityId: scope.facilityId,
        command, status: 'pending', createdAt: timestamp, attempts: 0,
      });
      this.assertScope(scope);
      return publicPatient(patient);
    });
    this.assertScope(scope);
    return saved;
  }

  async mergeServerPatients(patients: Patient[], session: AuthSession): Promise<void> {
    const scope = this.scope();
    // A fetch may have started before logout or a user/facility switch. Never
    // place its response in the currently unlocked partition by assumption.
    this.assertSession(scope, session);
    if (patients.some(patient => patient.facilityId !== scope.facilityId)) {
      throw new ApiError(403, 'The returned data is outside your facility.', 'FACILITY_MISMATCH');
    }
    await this.db.transaction('rw', this.db.patients, this.db.commands, async () => {
      for (const patient of patients) {
        this.assertScope(scope);
        const current = await this.db.patients.get([scope.userId, scope.facilityId, patient.id]);
        if (current && patient.version < current.serverVersion) continue;
        const pending = orderCommands(await this.rows(scope, patient.id));
        const base = { ...patient, userId: scope.userId, serverVersion: patient.version, serverSnapshot: patient };
        await this.db.patients.put(pending.length && current ? {
          ...current, serverVersion: patient.version, serverSnapshot: patient,
        } : { ...base, syncStatus: 'synced' });
      }
      this.assertScope(scope);
    });
  }

  private async recordFailure(scope: Scope, row: QueuedPatientCommand, error: ApiError): Promise<void> {
    await this.db.transaction('rw', this.db.patients, this.db.commands, async () => {
      this.assertScope(scope);
      const key: [string, string, string] = [scope.userId, scope.facilityId, row.operationId];
      const current = await this.db.commands.get(key);
      // Another tab may already have acknowledged this exact operation.
      if (!current) return;
      const status = error.status === 409 ? 'conflict'
        : error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status) ? 'rejected' : 'pending';
      await this.db.commands.update(key, { status, lastError: error.message, attempts: current.attempts + 1 });
      await this.db.patients.update([scope.userId, scope.facilityId, row.entityId], {
        syncStatus: status, syncError: error.message,
      });
      this.assertScope(scope);
    });
  }

  private async acknowledge(scope: Scope, row: QueuedPatientCommand, result: CommandResult): Promise<void> {
    if (result.operationId !== row.operationId || result.patient.id !== row.entityId
      || result.patient.facilityId !== scope.facilityId || result.patient.version !== row.command.expectedVersion + 1) {
      throw new ApiError(502, 'The server acknowledgment did not match this command. The draft remains queued.', 'INVALID_ACKNOWLEDGMENT');
    }
    await this.db.transaction('rw', this.db.patients, this.db.commands, async () => {
      this.assertScope(scope);
      const current = await this.db.patients.get([scope.userId, scope.facilityId, row.entityId]);
      if (!current) throw new Error('The local patient projection is missing; acknowledgment was not applied.');
      await this.db.commands.delete([scope.userId, scope.facilityId, row.operationId]);
      const remaining = orderCommands(await this.rows(scope, row.entityId));
      const latest = remaining.at(-1);
      const blocked = remaining.find(command => command.status !== 'pending');
      const base = current.serverSnapshot && current.serverVersion > result.patient.version ? current.serverSnapshot : result.patient;
      await this.db.patients.put({
        ...base, userId: scope.userId, serverSnapshot: base, serverVersion: base.version,
        ...(latest ? { demographics: latest.command.payload, version: latest.command.expectedVersion + 1, updatedAt: latest.createdAt } : {}),
        syncStatus: blocked?.status ?? (latest ? 'pending' : 'synced'),
        syncError: blocked?.lastError,
      });
      this.assertScope(scope);
    });
  }

  async flushPending(session: AuthSession): Promise<FlushResult> {
    const scope = this.scope('patient:write');
    this.assertSession(scope, session);
    const originalSession = structuredClone(session);
    return coordinated(`labcopilot:patient-push:${this.db.name}:${scope.userId}:${scope.facilityId}`, async () => {
      this.assertScope(scope);
      const pending = await this.outbox();
      const blockedEntities = new Set(pending.filter(row => row.status !== 'pending').map(row => row.entityId));
      let accepted = 0;
      for (const row of pending) {
        this.assertScope(scope);
        if (blockedEntities.has(row.entityId)) continue;
        try {
          const result = await this.send(structuredClone(row.command), originalSession);
          this.assertScope(scope);
          await this.acknowledge(scope, row, result);
          accepted += 1;
        } catch (error) {
          if (error instanceof SessionLockedError) throw error;
          const failure = error instanceof ApiError ? error : new ApiError(0, 'Submission was interrupted. The unchanged command will be retried.');
          await this.recordFailure(scope, row, failure);
          if (failure.status === 401 || failure.status === 403) {
            this.lock();
            throw failure;
          }
          if (failure.status === 0 || failure.status >= 500 || failure.status === 408 || failure.status === 429) break;
          blockedEntities.add(row.entityId);
        }
      }
      const remaining = await this.outbox();
      return { accepted, remaining: remaining.length, blocked: remaining.filter(row => row.status !== 'pending').length };
    });
  }

  async flushWorkflow(session: AuthSession): Promise<FlushResult> {
    const scope = this.scope();
    this.assertSession(scope, session);
    const originalSession = structuredClone(session);
    return coordinated(`labcopilot:workflow-push:${this.db.name}:${scope.userId}:${scope.facilityId}`, async () => {
      this.assertScope(scope);
      const queued = await this.workflowOutbox();
      const blockedEntities = new Set(queued.filter(row => row.status !== 'pending').map(row => row.entityId));
      let accepted = 0;
      for (const row of queued) {
        this.assertScope(scope);
        if (blockedEntities.has(row.entityId) || row.status !== 'pending') continue;
        const required = workflowPermission(row.command);
        if (row.command.kind.startsWith('result.') && !['result.create', 'result.revise'].includes(row.command.kind)) {
          await this.db.workflowCommands.update([scope.userId, scope.facilityId, row.operationId], {
            status: 'rejected', lastError: 'Only result drafts can be submitted from the offline outbox.', attempts: row.attempts + 1,
          });
          blockedEntities.add(row.entityId);
          continue;
        }
        if (!originalSession.user.permissions.includes(required)) {
          await this.db.workflowCommands.update([scope.userId, scope.facilityId, row.operationId], {
            status: 'rejected', lastError: 'Your current role no longer permits this workflow action.', attempts: row.attempts + 1,
          });
          blockedEntities.add(row.entityId);
          continue;
        }
        try {
          const result = await this.sendWorkflow(structuredClone(row.command), originalSession);
          this.assertScope(scope);
          const entity = row.command.kind.startsWith('result.') ? result.result
            : row.command.kind === 'order.create' ? result.order : result.specimen;
          if (result.operationId !== row.operationId || !entity || entity.id !== row.entityId
            || entity.facilityId !== scope.facilityId || entity.version !== row.command.expectedVersion + 1) {
            throw new ApiError(502, 'The server acknowledgment did not match this workflow command.', 'INVALID_ACKNOWLEDGMENT');
          }
          await this.db.transaction('rw', this.db.workflowCommands, this.db.results, this.db.analyticalWorklist, async () => {
            this.assertScope(scope);
            if (result.result) {
              await this.putResult(scope, result.result);
              const workingSet = await this.db.analyticalWorklist.get([scope.userId, scope.facilityId]);
              if (workingSet) {
                workingSet.items = workingSet.items.map(item => item.accessionId === result.result!.accessionId
                  && item.orderItemId === result.result!.orderItemId && item.testId === result.result!.testId
                  && (!item.result || item.result.version <= result.result!.version) ? { ...item, result: result.result } : item);
                await this.db.analyticalWorklist.put(workingSet);
              }
            }
            await this.db.workflowCommands.delete([scope.userId, scope.facilityId, row.operationId]);
            this.assertScope(scope);
          });
          accepted += 1;
        } catch (error) {
          if (error instanceof SessionLockedError) throw error;
          const failure = error instanceof ApiError ? error : new ApiError(0, 'Submission was interrupted. The unchanged command will be retried.');
          const status = failure.status === 409 ? 'conflict'
            : failure.status >= 400 && failure.status < 500 && ![401, 403, 408, 429].includes(failure.status) ? 'rejected' : 'pending';
          await this.db.workflowCommands.update([scope.userId, scope.facilityId, row.operationId], {
            status, lastError: failure.message, attempts: row.attempts + 1,
          });
          if (failure.status === 401 || failure.status === 403) {
            this.lock();
            throw failure;
          }
          if (status !== 'pending') blockedEntities.add(row.entityId);
          if (failure.status === 0 || failure.status >= 500 || failure.status === 408 || failure.status === 429) break;
        }
      }
      const remaining = await this.workflowOutbox();
      return { accepted, remaining: remaining.length, blocked: remaining.filter(row => row.status !== 'pending').length };
    });
  }
}

export const patientStore = new PatientStore();


