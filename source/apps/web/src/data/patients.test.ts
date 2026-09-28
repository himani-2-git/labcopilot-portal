import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, CommandResult, OrderCommand, Patient, PatientCommand, PatientDemographics, WorkflowCommandResult } from '@labcopilot/contracts';
import { ApiError } from '../lib/api';
import { PatientStore, SessionLockedError } from './patients';

const currentTime = Date.parse('2026-09-19T12:00:00.000Z');
const facility = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const session = (id = actor, facilityId = facility): AuthSession => ({
  user: {
    id, username: 'demo.clerk', displayName: 'Demo Registration Clerk', role: 'registration_clerk',
    facilityId, facilityName: 'Demo Hospital', permissions: ['patient:read', 'patient:write', 'catalog:read', 'order:read', 'order:write', 'specimen:read', 'specimen:write'],
  },
  csrfToken: 'synthetic-test-csrf-token', expiresAt: '2026-09-19T20:00:00.000Z', authMode: 'development',
});

describe('pre-analytical command outbox', () => {
  const orderCommand = (): OrderCommand => ({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    entityId: crypto.randomUUID(),
    expectedVersion: 0,
    kind: 'order.create',
    payload: {
      patientId: crypto.randomUUID(),
      priority: 'routine',
      items: [{ testId: crypto.randomUUID() }],
    },
  });

  it('caches the scoped synthetic catalog for disconnected order drafting', async () => {
    const store = makeStore();
    await store.cacheCatalog([{
      id: crypto.randomUUID(), code: 'DEMO-HGB', name: 'Demo haemoglobin', specimenType: 'whole_blood', unit: 'g/dL', status: 'active',
    }], [], session());
    await expect(store.cachedCatalog()).resolves.toMatchObject({ tests: [{ code: 'DEMO-HGB', status: 'active' }], panels: [] });
  });

  it('persists an offline workflow command and removes it only after a matching acknowledgment', async () => {
    const sendWorkflow = vi.fn(async (command: OrderCommand): Promise<WorkflowCommandResult> => ({
      operationId: command.operationId,
      replayed: false,
      order: {
        id: command.entityId,
        facilityId: facility,
        patientId: command.payload.patientId,
        patientName: 'Demo Patient 001',
        version: 1,
        priority: command.payload.priority,
        status: 'ordered',
        orderedBy: 'Demo Registration Clerk',
        orderedAt: new Date(currentTime).toISOString(),
        updatedAt: new Date(currentTime).toISOString(),
        items: [],
        specimens: [],
      },
    }));
    const store = makeStore({ sendWorkflow: sendWorkflow as NonNullable<ConstructorParameters<typeof PatientStore>[0]>['sendWorkflow'] });
    const command = orderCommand();
    await store.queueWorkflow(command);
    expect(await store.workflowOutbox()).toMatchObject([{ operationId: command.operationId, status: 'pending', attempts: 0 }]);
    await expect(store.flushWorkflow(session())).resolves.toEqual({ accepted: 1, remaining: 0, blocked: 0 });
    expect(sendWorkflow).toHaveBeenCalledOnce();
    expect(await store.workflowOutbox()).toEqual([]);
  });

  it('retains a stale workflow command as a visible conflict', async () => {
    const sendWorkflow = vi.fn().mockRejectedValue(new ApiError(409, 'The specimen version is stale.', 'CONFLICT'));
    const store = makeStore({ sendWorkflow });
    await store.queueWorkflow(orderCommand());
    await expect(store.flushWorkflow(session())).resolves.toEqual({ accepted: 0, remaining: 1, blocked: 1 });
    expect(await store.workflowOutbox()).toMatchObject([{ status: 'conflict', lastError: 'The specimen version is stale.', attempts: 1 }]);
  });
});
const demographics = (displayName = 'Demo Patient One'): PatientDemographics => ({
  displayName, dateOfBirth: '1991-01-15', sex: 'unknown', preferredLanguage: 'en', synthetic: true,
});
const snapshot = (command: PatientCommand): Patient => ({
  id: command.entityId, facilityId: facility, version: command.expectedVersion + 1,
  demographics: command.payload, createdAt: new Date(currentTime).toISOString(), updatedAt: new Date(currentTime).toISOString(),
});
const tracked: { name: string; store: PatientStore }[] = [];
function makeStore(options: ConstructorParameters<typeof PatientStore>[0] = {}) {
  const name = options.name ?? `labcopilot-test-${crypto.randomUUID()}`;
  const store = new PatientStore({ name, now: () => currentTime, ...options });
  tracked.push({ name, store });
  store.unlock(session());
  return store;
}
afterEach(async () => {
  tracked.forEach(({ store }) => store.close());
  for (const name of new Set(tracked.map(item => item.name))) await Dexie.delete(name);
  tracked.length = 0;
});

describe('durable, actor-scoped patient drafts', () => {
  it('retains the projection and ordered create/edit commands after closing and reopening IndexedDB', async () => {
    const name = `labcopilot-reopen-${crypto.randomUUID()}`;
    const first = makeStore({ name });
    const created = await first.save(demographics());
    await first.save(demographics('Demo Edited Offline'), created.id);
    first.close();
    const recovered = makeStore({ name });
    const patient = await recovered.get(created.id);
    expect(patient).toMatchObject({ version: 2, serverVersion: 0, syncStatus: 'pending', demographics: { displayName: 'Demo Edited Offline' } });
    const queue = await recovered.outbox();
    expect(queue.map(row => [row.command.kind, row.command.expectedVersion])).toEqual([
      ['patient.create', 0], ['patient.update', 1],
    ]);
    expect(queue.every(row => row.userId === actor && row.facilityId === facility)).toBe(true);
  });

  it('rolls back the projection if its paired immutable command cannot be persisted', async () => {
    const entityId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const uuid = vi.fn().mockReturnValueOnce(entityId).mockReturnValue(operationId);
    const store = makeStore({ uuid });
    await store.save(demographics());
    await expect(store.save(demographics('Demo Failed Edit'), entityId)).rejects.toThrow();
    expect(await store.get(entityId)).toMatchObject({ version: 1, demographics: { displayName: 'Demo Patient One' } });
    expect(await store.outbox()).toHaveLength(1);
  });

  it('serializes concurrent edits without overwriting an earlier queued operation', async () => {
    const store = makeStore();
    const patient = await store.save(demographics());
    await Promise.all([
      store.save(demographics('Demo Edit A'), patient.id),
      store.save(demographics('Demo Edit B'), patient.id),
    ]);
    expect((await store.outbox()).map(row => row.command.expectedVersion)).toEqual([0, 1, 2]);
    expect((await store.get(patient.id))?.version).toBe(3);
  });

  it('does not allow one user or facility to read or submit another partition', async () => {
    const send = vi.fn();
    const store = makeStore({ send });
    const patient = await store.save(demographics());
    store.unlock(session('33333333-3333-4333-8333-333333333333'));
    expect(await store.list()).toEqual([]);
    expect(await store.get(patient.id)).toBeUndefined();
    expect(await store.outbox()).toEqual([]);
    await expect(store.save(demographics('Demo Wrong Actor'), patient.id)).rejects.toThrow('not available');
    await expect(store.flushPending(session())).rejects.toBeInstanceOf(SessionLockedError);
    store.unlock(session(actor, '44444444-4444-4444-8444-444444444444'));
    expect(await store.list()).toEqual([]);
    expect(await store.outbox()).toEqual([]);
    await expect(store.mergeServerPatients([snapshot({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: patient.id, expectedVersion: 0, kind: 'patient.create', payload: demographics() })], session(actor, '44444444-4444-4444-8444-444444444444'))).rejects.toMatchObject({ status: 403 });
    store.unlock(session());
    expect(await store.get(patient.id)).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('locks every local read/write/submission after session expiry while retaining saved work', async () => {
    let now = currentTime;
    const store = makeStore({ now: () => now });
    const patient = await store.save(demographics());
    now = Date.parse(session().expiresAt) + 1;
    await expect(store.list()).rejects.toBeInstanceOf(SessionLockedError);
    await expect(store.get(patient.id)).rejects.toBeInstanceOf(SessionLockedError);
    await expect(store.outbox()).rejects.toBeInstanceOf(SessionLockedError);
    await expect(store.save(demographics())).rejects.toBeInstanceOf(SessionLockedError);
    await expect(store.flushPending(session())).rejects.toBeInstanceOf(SessionLockedError);
    store.unlock({ ...session(), expiresAt: '2026-09-20T20:00:00.000Z' });
    expect(await store.get(patient.id)).toBeDefined();
    expect(await store.outbox()).toHaveLength(1);
  });

  it('denies local mutation for a read-only role', async () => {
    const store = makeStore();
    store.unlock({ ...session(), user: { ...session().user, role: 'technician', permissions: ['patient:read'] } });
    await expect(store.save(demographics())).rejects.toMatchObject({ status: 403 });
    expect(await store.list()).toEqual([]);
  });

  it('merges server bases without erasing unacknowledged local edits', async () => {
    const store = makeStore();
    const created = await store.save(demographics());
    await store.save(demographics('Demo Locally Edited'), created.id);
    const [create] = await store.outbox();
    await store.mergeServerPatients([snapshot(create!.command)], session());
    expect(await store.get(created.id)).toMatchObject({
      version: 2, serverVersion: 1, syncStatus: 'pending', demographics: { displayName: 'Demo Locally Edited' },
    });
    expect(await store.outbox()).toHaveLength(2);
  });

  it('rejects an earlier session’s fetched data after another user or session unlocks the workspace', async () => {
    const store = makeStore();
    await store.save(demographics());
    const [row] = await store.outbox();
    const fetched = [snapshot(row!.command)];
    store.unlock(session('33333333-3333-4333-8333-333333333333'));
    await expect(store.mergeServerPatients(fetched, session())).rejects.toBeInstanceOf(SessionLockedError);
    expect(await store.list()).toEqual([]);
    store.unlock({ ...session(), csrfToken: 'newly-authenticated-session-token' });
    await expect(store.mergeServerPatients(fetched, session())).rejects.toBeInstanceOf(SessionLockedError);
    expect(await store.outbox()).toHaveLength(1);
  });

  it('does not persist a non-synthetic payload or invalid demographics', async () => {
    const store = makeStore();
    await expect(store.save({ ...demographics(), synthetic: false } as unknown as PatientDemographics)).rejects.toThrow();
    await expect(store.save(demographics('Unlabelled patient'))).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    expect(await store.outbox()).toEqual([]);
  });
});

describe('limited patient command submission', () => {
  it('retries the same operation after a lost acknowledgment and then submits dependent edits in order', async () => {
    const receipts = new Map<string, CommandResult>();
    const mutations: PatientCommand[] = [];
    let dropAcknowledgment = true;
    const send = vi.fn(async (command: PatientCommand): Promise<CommandResult> => {
      const receipt = receipts.get(command.operationId);
      if (receipt) return { ...receipt, replayed: true };
      mutations.push(command);
      const result = { operationId: command.operationId, patient: snapshot(command), replayed: false };
      receipts.set(command.operationId, result);
      if (dropAcknowledgment) {
        dropAcknowledgment = false;
        throw new ApiError(0, 'Connection lost after commit');
      }
      return result;
    });
    const store = makeStore({ send });
    const patient = await store.save(demographics());
    await store.save(demographics('Demo Second Revision'), patient.id);
    const originalCommands = (await store.outbox()).map(row => row.command);
    expect(await store.flushPending(session())).toMatchObject({ accepted: 0, remaining: 2 });
    expect((await store.outbox()).map(row => row.command)).toEqual(originalCommands);
    expect(await store.flushPending(session())).toEqual({ accepted: 2, remaining: 0, blocked: 0 });
    expect(mutations.map(command => command.expectedVersion)).toEqual([0, 1]);
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(await store.get(patient.id)).toMatchObject({ version: 2, serverVersion: 2, syncStatus: 'synced' });
  });

  it('blocks descendants of a conflicting patient and can submit unrelated patients', async () => {
    let conflictId = '';
    const send = vi.fn(async (command: PatientCommand): Promise<CommandResult> => {
      if (command.entityId === conflictId) throw new ApiError(409, 'The server has a newer version.');
      return { operationId: command.operationId, patient: snapshot(command), replayed: false };
    });
    const store = makeStore({ send });
    const conflicted = await store.save(demographics());
    conflictId = conflicted.id;
    await store.save(demographics('Demo Dependent Edit'), conflicted.id);
    const other = await store.save(demographics('Demo Unrelated Patient'));
    expect(await store.flushPending(session())).toEqual({ accepted: 1, remaining: 2, blocked: 1 });
    expect(send.mock.calls.filter(([command]) => command.entityId === conflictId)).toHaveLength(1);
    expect(await store.get(conflictId)).toMatchObject({ syncStatus: 'conflict', demographics: { displayName: 'Demo Dependent Edit' } });
    expect(await store.get(other.id)).toMatchObject({ syncStatus: 'synced' });
    await expect(store.save(demographics('Demo Unsafe Overwrite'), conflictId)).rejects.toThrow('reconciliation');
    await store.flushPending(session());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retains pending commands and locks the workspace when server authorization is denied', async () => {
    const store = makeStore({ send: async () => { throw new ApiError(403, 'Permission revoked'); } });
    const patient = await store.save(demographics());
    await expect(store.flushPending(session())).rejects.toMatchObject({ status: 403 });
    await expect(store.list()).rejects.toBeInstanceOf(SessionLockedError);
    store.unlock(session());
    expect(await store.outbox()).toHaveLength(1);
    expect(await store.get(patient.id)).toMatchObject({ syncStatus: 'pending', syncError: 'Permission revoked' });
  });

  it('retains the exact operation when an acknowledgment has the wrong entity or revision', async () => {
    const send = vi.fn(async (command: PatientCommand): Promise<CommandResult> => ({
      operationId: command.operationId, patient: { ...snapshot(command), version: 99 }, replayed: false,
    }));
    const store = makeStore({ send });
    const patient = await store.save(demographics());
    const original = (await store.outbox())[0]!.command;
    expect(await store.flushPending(session())).toEqual({ accepted: 0, remaining: 1, blocked: 0 });
    expect((await store.outbox())[0]!.command).toEqual(original);
    expect(await store.get(patient.id)).toMatchObject({ version: 1, serverVersion: 0, syncStatus: 'pending' });
  });

  it('serializes concurrent submit actions and acknowledges each queued operation once', async () => {
    const send = vi.fn(async (command: PatientCommand): Promise<CommandResult> => ({
      operationId: command.operationId, patient: snapshot(command), replayed: false,
    }));
    const store = makeStore({ send });
    const patient = await store.save(demographics());
    await store.save(demographics('Demo Second Revision'), patient.id);
    const results = await Promise.all([store.flushPending(session()), store.flushPending(session())]);
    expect(results.map(result => result.accepted)).toEqual([2, 0]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await store.outbox()).toEqual([]);
  });

  it('does not apply an in-flight response after the workspace changes users', async () => {
    let complete!: (result: CommandResult) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    const send = vi.fn((command: PatientCommand) => {
      started();
      return new Promise<CommandResult>(resolve => { complete = resolve; });
    });
    const store = makeStore({ send });
    await store.save(demographics());
    const [row] = await store.outbox();
    const flush = store.flushPending(session());
    await requestStarted;
    store.unlock(session('33333333-3333-4333-8333-333333333333'));
    complete({ operationId: row!.operationId, patient: snapshot(row!.command), replayed: false });
    await expect(flush).rejects.toBeInstanceOf(SessionLockedError);
    expect(await store.list()).toEqual([]);
    store.unlock(session());
    expect(await store.outbox()).toHaveLength(1);
  });
});

