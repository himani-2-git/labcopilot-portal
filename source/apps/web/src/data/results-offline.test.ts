import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS, type AnalyticalResult, type AnalyticalWorkItem, type AuthSession, type ResultDraftCommand, type WorkflowCommandResult } from '@labcopilot/contracts';
import { ApiError } from '../lib/api';
import { PatientStore, SessionLockedError, type WorkflowCommand } from './patients';

const facility = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-09-23T12:00:00Z');
const session = (): AuthSession => ({ user: { id: actor, username: 'technician', displayName: 'Demo Technician',
  role: 'technician', facilityId: facility, facilityName: 'Demo Hospital', permissions: ROLE_PERMISSIONS.technician },
  csrfToken: 'synthetic-test-token', expiresAt: '2026-09-23T20:00:00Z', authMode: 'development' });
const createCommand = (): ResultDraftCommand => ({ protocolVersion: 1, operationId: crypto.randomUUID(),
  entityId: crypto.randomUUID(), expectedVersion: 0, kind: 'result.create', payload: {
    specimenId: crypto.randomUUID(), accessionId: crypto.randomUUID(), orderItemId: crypto.randomUUID(), testId: crypto.randomUUID(),
    value: { kind: 'numeric', value: '9007199254740993.000000000000000001', unit: 'demo-unit' },
  } });
const serverResult = (command: ResultDraftCommand): AnalyticalResult => ({
  id: command.entityId, facilityId: facility, patientId: crypto.randomUUID(), patientName: 'Demo Patient 001', orderId: crypto.randomUUID(),
  ...(command.kind === 'result.create' ? command.payload : { specimenId: crypto.randomUUID(), accessionId: crypto.randomUUID(), orderItemId: crypto.randomUUID(), testId: crypto.randomUUID() }),
  testCode: 'DEMO-NUM', testName: 'Demo numeric test', accessionIdentifier: 'ACC-DEMO', version: command.expectedVersion + 1,
  status: 'draft', value: command.payload.value, policy: { version: 'demo-v1', label: 'Synthetic only', synthetic: true, valueKind: 'numeric', expectedUnit: 'demo-unit' },
  validation: { outcome: 'not_run', issues: [], flag: 'not_evaluated', critical: 'not_evaluated' }, qc: { status: 'missing' },
  readiness: 'pending', criticalReviewRequired: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
});
const workItem = (result: AnalyticalResult): AnalyticalWorkItem => ({ ...result, specimenBarcode: 'SPM-DEMO', result });
const tracked: { name: string; store: PatientStore }[] = [];
function makeStore(options: ConstructorParameters<typeof PatientStore>[0] = {}) {
  const name = options.name ?? `phase3-offline-${crypto.randomUUID()}`;
  const store = new PatientStore({ name, now: () => now, ...options });
  tracked.push({ name, store }); store.unlock(session()); return store;
}
afterEach(async () => {
  tracked.forEach(item => item.store.close());
  for (const name of new Set(tracked.map(item => item.name))) await Dexie.delete(name);
  tracked.length = 0;
});

describe('analytical drafts in the existing workflow outbox', () => {
  it('persists exact draft strings and cached context after reopening, without asserting validation', async () => {
    const name = `phase3-reopen-${crypto.randomUUID()}`;
    const first = makeStore({ name }); const command = createCommand(); const result = serverResult(command);
    await first.cacheAnalyticalWorklist([workItem(result)], session());
    await first.queueWorkflow(command); first.close();
    const reopened = makeStore({ name });
    expect((await reopened.workflowOutbox())[0]?.command).toEqual(command);
    expect(await reopened.cachedAnalyticalWorklist()).toMatchObject({ items: [{ accessionId: result.accessionId }] });
    expect(await reopened.cachedResult(result.id)).toMatchObject({ status: 'draft', validation: { outcome: 'not_run' } });
  });

  it('acknowledges a matching command and atomically updates the cached server result', async () => {
    const command = createCommand(); const result = serverResult(command);
    const sendWorkflow = vi.fn().mockResolvedValue({ operationId: command.operationId, result, replayed: false });
    const store = makeStore({ sendWorkflow }); await store.cacheAnalyticalWorklist([{ ...workItem(result), result: undefined }], session());
    await store.queueWorkflow(command);
    expect(await store.flushWorkflow(session())).toEqual({ accepted: 1, remaining: 0, blocked: 0 });
    expect(await store.cachedResult(result.id)).toEqual(result);
    expect((await store.cachedAnalyticalWorklist())?.items[0]?.result?.id).toBe(result.id);
  });

  it('retains the same operation identity after uncertain transport and retries safely', async () => {
    const command = createCommand(); const result = serverResult(command);
    const sendWorkflow = vi.fn().mockRejectedValueOnce(new ApiError(0, 'Disconnected')).mockResolvedValueOnce({ operationId: command.operationId, result, replayed: true });
    const store = makeStore({ sendWorkflow }); await store.queueWorkflow(command);
    expect(await store.flushWorkflow(session())).toMatchObject({ accepted: 0, remaining: 1 });
    expect(await store.flushWorkflow(session())).toMatchObject({ accepted: 1, remaining: 0 });
    expect(sendWorkflow.mock.calls.map(call => call[0])).toEqual([command, command]);
  });

  it.each(['id', 'facilityId', 'version'] as const)('keeps the command when acknowledgment has a mismatched %s', async field => {
    const command = createCommand(); const result = serverResult(command);
    const sendWorkflow = vi.fn().mockResolvedValue({ operationId: command.operationId, result: { ...result, [field]: field === 'version' ? 99 : crypto.randomUUID() }, replayed: false });
    const store = makeStore({ sendWorkflow }); await store.queueWorkflow(command);
    expect(await store.flushWorkflow(session())).toMatchObject({ accepted: 0, remaining: 1 });
    expect(await store.workflowOutbox()).toMatchObject([{ status: 'pending', lastError: expect.stringContaining('acknowledgment') }]);
    expect(await store.cachedResult(command.entityId)).toBeUndefined();
  });

  it('preserves a stale correction as a conflict and keeps the server snapshot separate', async () => {
    const command = createCommand(); const result = { ...serverResult(command), version: 4, status: 'validated' as const };
    const revise: ResultDraftCommand = { protocolVersion: 1, operationId: crypto.randomUUID(), entityId: result.id, expectedVersion: 4,
      kind: 'result.revise', payload: { value: { kind: 'numeric', value: '2', unit: 'demo-unit' }, reason: 'Demo correction' } };
    const store = makeStore({ sendWorkflow: vi.fn().mockRejectedValue(new ApiError(409, 'Stale version', 'VERSION_CONFLICT')) });
    await store.cacheResult(result, session()); await store.queueWorkflow(revise);
    expect(await store.cachedResult(result.id)).toEqual(result);
    expect(await store.flushWorkflow(session())).toEqual({ accepted: 0, remaining: 1, blocked: 1 });
    expect(await store.workflowOutbox()).toMatchObject([{ status: 'conflict', command: revise }]);
    await expect(store.queueWorkflow({ ...revise, operationId: crypto.randomUUID() })).rejects.toThrow('already has a saved draft');
  });

  it.each(['result.enter', 'result.validate', 'result.readiness', 'result.qc'])('rejects %s at the local store boundary', async kind => {
    const store = makeStore(); const command = { ...createCommand(), kind, expectedVersion: 1,
      payload: kind === 'result.qc' ? { status: 'pass', reason: 'Demo control pass' } : {} };
    await expect(store.queueWorkflow(command as WorkflowCommand)).rejects.toThrow('Only result drafts');
    expect(await store.workflowOutbox()).toEqual([]);
  });

  it('prevents duplicate local creates for the same accession, order item and test', async () => {
    const store = makeStore(); const command = createCommand(); await store.queueWorkflow(command);
    await expect(store.queueWorkflow({ ...command, entityId: crypto.randomUUID(), operationId: crypto.randomUUID() })).rejects.toThrow('already saved');
  });

  it('isolates cached results and drafts by actor and facility and respects session locking', async () => {
    const store = makeStore(); const command = createCommand(); await store.queueWorkflow(command); await store.cacheResult(serverResult(command), session());
    const other = session(); other.user.id = crypto.randomUUID(); store.unlock(other);
    expect(await store.workflowOutbox()).toEqual([]); expect(await store.cachedResult(command.entityId)).toBeUndefined();
    other.user.facilityId = crypto.randomUUID(); store.unlock(other);
    expect(await store.cachedAnalyticalWorklist()).toBeUndefined();
    store.lock(); await expect(store.workflowOutbox()).rejects.toBeInstanceOf(SessionLockedError);
  });

  it('denies drafts to read-only approvers and rejects cross-facility cache responses', async () => {
    const store = makeStore(); const command = createCommand();
    await expect(store.cacheResult({ ...serverResult(command), facilityId: crypto.randomUUID() }, session())).rejects.toMatchObject({ status: 403 });
    const reader = session(); reader.user.role = 'qualified_approver'; reader.user.permissions = ROLE_PERMISSIONS.qualified_approver; store.unlock(reader);
    await expect(store.queueWorkflow(command)).rejects.toMatchObject({ status: 403 });
  });

  it('does not apply an in-flight acknowledgment after the session is locked', async () => {
    const command = createCommand(); let reply!: (value: WorkflowCommandResult) => void;
    const sendWorkflow = vi.fn(() => new Promise<WorkflowCommandResult>(resolve => { reply = resolve; }));
    const store = makeStore({ sendWorkflow }); await store.queueWorkflow(command);
    const pending = store.flushWorkflow(session()); await vi.waitFor(() => expect(sendWorkflow).toHaveBeenCalledOnce());
    store.lock(); reply({ operationId: command.operationId, result: serverResult(command), replayed: false });
    await expect(pending).rejects.toBeInstanceOf(SessionLockedError);
    store.unlock(session()); expect(await store.workflowOutbox()).toHaveLength(1);
    expect(await store.cachedResult(command.entityId)).toBeUndefined();
  });
});
