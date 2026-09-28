import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import type { AnalyticalResult, AuthSession, OrderCommand, PatientCommand, PatientDemographics, ResultCommand, ResultValue, SpecimenCommand } from '@labcopilot/contracts';

const require = createRequire(import.meta.url);
const { createApp, validateDevelopmentConfiguration } = require('../dist/bootstrap.js');
const { seedDemoUsers } = require('../dist/seed.js');
const { seedDemoCatalog } = require('../dist/laboratory/seed.js');
const origin = 'http://localhost:5173';
const password = randomBytes(24).toString('hex');
let app: Awaited<ReturnType<typeof createApp>>;
let db: PrismaClient;
let base: string;
type Client = { cookie: string; session: AuthSession };
let clerk: Client; let technician: Client; let approver: Client; let admin: Client; let other: Client;
const demographics: PatientDemographics = { displayName: 'Demo Integration Patient', dateOfBirth: '1994-01-12', sex: 'female', preferredLanguage: 'en', synthetic: true };
function command(override: Partial<PatientCommand> = {}): PatientCommand {
  return { protocolVersion: 1, operationId: randomUUID(), entityId: randomUUID(), kind: 'patient.create', expectedVersion: 0, payload: { ...demographics }, ...override };
}
function headers(client?: Client): Record<string, string> {
  return { 'content-type': 'application/json', origin,
    ...(client ? { cookie: client.cookie, 'x-csrf-token': client.session.csrfToken, 'x-workspace-user-id': client.session.user.id, 'x-workspace-facility-id': client.session.user.facilityId } : {}) };
}
async function request(path: string, client?: Client, body?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers(client), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(username: string): Promise<Client> {
  const response = await request('/auth/login', undefined, { username, password });
  expect(response.status).toBe(200);
  const raw = response.headers.get('set-cookie')!;
  expect(raw).toContain('HttpOnly'); expect(raw).toContain('SameSite=Strict');
  return { cookie: raw.split(';')[0], session: await response.json() as AuthSession };
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/^\/[a-z0-9_]+_test$/i.test(new URL(url).pathname)) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test. API tests do not run against development data.');
  process.env.DATABASE_URL = url; process.env.NODE_ENV = 'test'; process.env.AUTH_MODE = 'development'; process.env.WEB_ORIGIN = origin;
  const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, encoding: 'utf8' });
  if (migration.status !== 0) throw new Error(`Test migration failed: ${migration.stderr || migration.stdout}`);
  db = new PrismaClient();
  await seedDemoUsers(db, password);
  await seedDemoCatalog(db);
  app = await createApp(); await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1`;
  clerk = await login('clerk'); technician = await login('technician'); approver = await login('approver'); admin = await login('admin'); other = await login('other-clerk');
});
afterAll(async () => { if (app) await app.close(); if (db) await db.$disconnect(); });

describe('authentication and server authorization', () => {
  it('requires explicit non-production development mode', () => {
    const before = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    expect(() => validateDevelopmentConfiguration()).toThrow('only explicitly enabled'); process.env.NODE_ENV = before;
  });
  it('connects to PostgreSQL and does not cache API responses', async () => {
    const response = await request('/health'); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).database).toBe('connected');
  });
  it('denies unauthenticated access and invalid credentials', async () => {
    expect((await request('/patients')).status).toBe(401);
    expect((await request('/auth/login', undefined, { username: 'clerk', password: 'incorrect' })).status).toBe(401);
    expect((await request('/auth/login', undefined, { username: 'clerk', password }, { origin: 'https://hostile.invalid' })).status).toBe(403);
  });
  it('returns an authenticated session; stores only a hashed bearer token', async () => {
    expect((await request('/auth/session', clerk)).status).toBe(200);
    const raw = clerk.cookie.split('=')[1];
    expect(await db.session.findUnique({ where: { tokenHash: raw } })).toBeNull();
  });
  it('enforces CSRF, origin and workspace identity before mutations', async () => {
    expect((await request('/patients/commands', clerk, command(), { 'x-csrf-token': '' })).status).toBe(403);
    expect((await request('/patients/commands', clerk, command(), { origin: 'https://hostile.invalid' })).status).toBe(403);
    expect((await request('/patients/commands', clerk, command(), { 'x-workspace-user-id': other.session.user.id })).status).toBe(403);
    expect((await request('/patients/commands', other, command(), { 'x-workspace-facility-id': clerk.session.user.facilityId })).status).toBe(403);
    expect((await request('/patients', clerk, undefined, { 'x-workspace-user-id': other.session.user.id })).status).toBe(403);
  });
  it('rejects a stale workspace after the browser cookie switches to another same-facility user', async () => {
    const original = await login('clerk');
    const switched = await request('/auth/login', original, { username: 'technician', password });
    expect(switched.status).toBe(200);
    const replacement: Client = { cookie: switched.headers.get('set-cookie')!.split(';')[0], session: await switched.json() as AuthSession };
    expect((await request('/auth/session', original)).status).toBe(401);
    expect((await request('/patients', replacement, undefined, { 'x-workspace-user-id': original.session.user.id })).status).toBe(403);
    expect((await request('/patients', replacement)).status).toBe(200);
  });
  it('enforces role boundaries including no clinical administrator authority', async () => {
    expect((await request('/patients', technician)).status).toBe(200);
    expect((await request('/patients/commands', technician, command())).status).toBe(403);
    expect((await request('/patients/commands', approver, command())).status).toBe(403);
    expect((await request('/patients', admin)).status).toBe(403);
    expect((await request('/admin/config', admin)).status).toBe(200);
    expect((await request('/admin/config', clerk)).status).toBe(403);
    expect((await request('/review/queue', admin)).status).toBe(403);
    const review = await request('/review/queue', approver); expect(review.status).toBe(200); expect((await review.json()).implemented).toBe(false);
  });
  it('rejects expired, revoked and signed-out sessions', async () => {
    const temporary = await login('clerk');
    expect((await request('/auth/logout', temporary, {})).status).toBe(200);
    expect((await request('/auth/session', temporary)).status).toBe(401);
    const expires = await login('clerk');
    await db.session.updateMany({ where: { userId: expires.session.user.id }, data: { expiresAt: new Date(0) } });
    expect((await request('/auth/session', expires)).status).toBe(401);
    clerk = await login('clerk');
    await db.user.update({ where: { id: clerk.session.user.id }, data: { active: false } });
    expect((await request('/auth/session', clerk)).status).toBe(401);
    await db.user.update({ where: { id: clerk.session.user.id }, data: { active: true } });
    clerk = await login('clerk');
  });
});

describe('atomic versioned synthetic patient commands', () => {
  it('creates, retrieves, edits and persists revisions/audit with correlation IDs', async () => {
    const create = command(); const correlationId = randomUUID();
    const response = await request('/patients/commands', clerk, create, { 'x-correlation-id': correlationId }); expect(response.status).toBe(200);
    const created = await response.json(); expect(created.patient.version).toBe(1); expect(created.replayed).toBe(false);
    expect((await (await request(`/patients/${create.entityId}`, clerk)).json()).demographics).toEqual(demographics);
    const update = command({ entityId: create.entityId, kind: 'patient.update', expectedVersion: 1, payload: { ...demographics, preferredLanguage: 'hi' } });
    const changed = await request('/patients/commands', clerk, update); expect(changed.status).toBe(200); expect((await changed.json()).patient.version).toBe(2);
    const history = await (await request(`/patients/${create.entityId}/history`, clerk)).json();
    expect(history.revisions.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    expect(history.audit).toHaveLength(2); expect(history.audit[1].correlationId).toBe(correlationId);
    expect(history.audit[1].actorId).toBe(clerk.session.user.id);
    const independentlyConnected = new PrismaClient();
    expect((await independentlyConnected.patient.findUniqueOrThrow({ where: { id: create.entityId } })).version).toBe(2);
    await independentlyConnected.$disconnect();
  });
  it('replays the same operation without duplicate patient, revision or audit; rejects altered payload reuse', async () => {
    const create = command();
    const first = await (await request('/patients/commands', clerk, create)).json();
    const again = await (await request('/patients/commands', clerk, create)).json();
    expect(again.patient).toEqual(first.patient); expect(again.replayed).toBe(true);
    expect(await db.patientRevision.count({ where: { patientId: create.entityId } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: create.entityId } })).toBe(1);
    expect((await request('/patients/commands', clerk, { ...create, payload: { ...create.payload, displayName: 'Demo Changed Retry' } })).status).toBe(409);
  });
  it('rechecks present permission before replaying a previously accepted operation', async () => {
    const create = command();
    expect((await request('/patients/commands', clerk, create)).status).toBe(200);
    await db.user.update({ where: { id: clerk.session.user.id }, data: { role: 'technician' } });
    try {
      expect((await request('/patients/commands', clerk, create)).status).toBe(403);
    } finally {
      await db.user.update({ where: { id: clerk.session.user.id }, data: { role: 'registration_clerk' } });
    }
    expect((await request('/patients/commands', clerk, create)).status).toBe(200);
    expect(await db.auditEvent.count({ where: { entityId: create.entityId } })).toBe(1);
  });
  it('serializes simultaneous identical commands and safely rejects same-entity competing creates', async () => {
    const create = command();
    const same = await Promise.all([request('/patients/commands', clerk, create), request('/patients/commands', clerk, create)]);
    expect(same.map(r => r.status)).toEqual([200, 200]);
    expect((await Promise.all(same.map(r => r.json()))).map(r => r.replayed).sort()).toEqual([false, true]);
    expect(await db.auditEvent.count({ where: { entityId: create.entityId } })).toBe(1);
    const entityId = randomUUID();
    const competing = await Promise.all([request('/patients/commands', clerk, command({ entityId })), request('/patients/commands', clerk, command({ entityId }))]);
    expect(competing.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.patientRevision.count({ where: { patientId: entityId } })).toBe(1);
  });
  it('rejects concurrent stale edits without losing the accepted version or adding audit', async () => {
    const create = command(); await request('/patients/commands', clerk, create);
    const edits = [command({ entityId: create.entityId, kind: 'patient.update', expectedVersion: 1, payload: { ...demographics, displayName: 'Demo First Edit' } }), command({ entityId: create.entityId, kind: 'patient.update', expectedVersion: 1, payload: { ...demographics, displayName: 'Demo Second Edit' } })];
    const results = await Promise.all(edits.map(edit => request('/patients/commands', clerk, edit)));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.auditEvent.count({ where: { entityId: create.entityId } })).toBe(2);
    expect(await db.patientRevision.count({ where: { patientId: create.entityId } })).toBe(2);
    expect((await db.patient.findUniqueOrThrow({ where: { id: create.entityId } })).version).toBe(2);
  });
  it('denies cross-facility reads, history, updates and creates with an existing identity', async () => {
    const create = command(); await request('/patients/commands', clerk, create);
    expect((await request(`/patients/${create.entityId}`, other)).status).toBe(404);
    expect((await request(`/patients/${create.entityId}/history`, other)).status).toBe(404);
    expect((await request('/patients/commands', other, command({ entityId: create.entityId, kind: 'patient.update', expectedVersion: 1 }))).status).toBe(404);
    expect((await request('/patients/commands', other, command({ entityId: create.entityId }))).status).toBe(404);
    const otherPatients = await (await request('/patients', other)).json(); expect(otherPatients.some((p: { id: string }) => p.id === create.entityId)).toBe(false);
  });
  it('rejects invalid identifiers, non-synthetic or unknown fields and invalid version semantics', async () => {
    expect((await request('/patients/invalid-id', clerk)).status).toBe(400);
    expect((await request('/patients/commands', clerk, { ...command(), payload: { ...demographics, synthetic: false } })).status).toBe(400);
    expect((await request('/patients/commands', clerk, { ...command(), payload: { ...demographics, displayName: 'Real Person' } })).status).toBe(400);
    expect((await request('/patients/commands', clerk, { ...command(), payload: { ...demographics, unexpected: 'field' } })).status).toBe(400);
    expect((await request('/patients/commands', clerk, command({ expectedVersion: 1 }))).status).toBe(400);
    expect((await request('/patients/commands', clerk, command({ kind: 'patient.update', expectedVersion: 0 }))).status).toBe(400);
  });
  it('database rejects missing or non-boolean synthetic markers even outside API validation', async () => {
    for (const invalid of [null, false, 'true']) {
      const payload = { ...demographics, synthetic: invalid };
      await expect(db.patient.create({ data: { id: randomUUID(), facilityId: clerk.session.user.facilityId, version: 1, demographics: payload } })).rejects.toThrow('Patient_synthetic_only');
    }
    const { synthetic: _synthetic, ...missingMarker } = demographics;
    await expect(db.patient.create({ data: { id: randomUUID(), facilityId: clerk.session.user.facilityId, version: 1, demographics: missingMarker } })).rejects.toThrow('Patient_synthetic_only');
  });
  it('database triggers prevent audit/revision alteration and deletion', async () => {
    const create = command(); await request('/patients/commands', clerk, create);
    await expect(db.auditEvent.updateMany({ where: { entityId: create.entityId }, data: { action: 'tampered' } })).rejects.toThrow('append-only');
    await expect(db.auditEvent.deleteMany({ where: { entityId: create.entityId } })).rejects.toThrow('append-only');
    await expect(db.patientRevision.updateMany({ where: { patientId: create.entityId }, data: { version: 99 } })).rejects.toThrow('append-only');
    await expect(db.patientRevision.deleteMany({ where: { patientId: create.entityId } })).rejects.toThrow('append-only');
  });
});

describe('pre-analytical catalog, orders, specimens and accession workflow', () => {
  function orderCommand(patientId: string, testId: string, override: Partial<OrderCommand> = {}): OrderCommand {
    return { protocolVersion: 1, operationId: randomUUID(), entityId: randomUUID(), expectedVersion: 0, kind: 'order.create', payload: { patientId, priority: 'routine', items: [{ testId }] }, ...override };
  }
  function specimenCommand(id: string, expectedVersion: number, kind: SpecimenCommand['kind'], payload: SpecimenCommand['payload'] = {}, operationId = randomUUID()): SpecimenCommand {
    return { protocolVersion: 1, operationId, entityId: id, expectedVersion, kind, payload };
  }
  async function createPatient() {
    const patient = command();
    return (await (await request('/patients/commands', clerk, patient)).json()).patient as { id: string };
  }
  it('lists structured synthetic catalog and enforces role/facility scope', async () => {
    const tests = await (await request('/catalog/tests', clerk)).json() as Array<{ code: string; status: string; specimenType: string }>;
    const panels = await (await request('/catalog/panels', clerk)).json() as Array<{ code: string; items: unknown[] }>;
    expect(tests.length).toBeGreaterThanOrEqual(4); expect(tests.every(test => test.code.startsWith('DEMO-') && test.status === 'active')).toBe(true);
    expect(panels.some(panel => panel.code === 'DEMO-CBC' && panel.items.length === 2)).toBe(true);
    expect((await request('/catalog/tests', admin)).status).toBe(403);
    expect((await request('/catalog/tests', other)).status).toBe(200);
  });
  it('creates an idempotent patient order and rejects cross-facility access', async () => {
    const patient = await createPatient();
    const tests = await (await request('/catalog/tests', clerk)).json() as Array<{ id: string; code: string }>;
    const create = orderCommand(patient.id, tests[0]!.id);
    const firstResponse = await request('/orders/commands', clerk, create); expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json(); expect(first.order.version).toBe(1); expect(first.order.items).toHaveLength(1);
    const replay = await (await request('/orders/commands', clerk, create)).json(); expect(replay.replayed).toBe(true); expect(replay.order.id).toBe(first.order.id);
    const history = await (await request(`/orders/${create.entityId}/history`, clerk)).json(); expect(history.audit.map((event: { action: string }) => event.action)).toContain('order.create');
    expect((await request(`/orders/${create.entityId}`, other)).status).toBe(404);
    expect((await request('/orders', admin)).status).toBe(403);
  });
  it('freezes panel membership, test labels and synthetic policy at order time', async () => {
    const patient = await createPatient();
    const firstTestId = randomUUID(); const secondTestId = randomUUID(); const panelId = randomUUID();
    const originalPolicy = { version: 'demo-frozen-1', label: 'Synthetic order-time policy', synthetic: true,
      valueKind: 'numeric', expectedUnit: 'demo-unit', lower: '0', upper: '10' };
    await db.laboratoryTest.createMany({ data: [
      { id: firstTestId, code: `DEMO-FROZEN-${firstTestId.slice(0, 8)}`, name: 'Demo frozen first test', specimenType: 'serum', unit: 'demo-unit', analyticalPolicy: originalPolicy },
      { id: secondTestId, code: `DEMO-FROZEN-${secondTestId.slice(0, 8)}`, name: 'Demo frozen second test', specimenType: 'serum', unit: 'demo-unit', analyticalPolicy: originalPolicy },
    ] });
    const removedPanelItemId = randomUUID();
    await db.laboratoryPanel.create({ data: { id: panelId, code: `DEMO-PANEL-${panelId.slice(0, 8)}`, name: 'Demo frozen panel',
      items: { create: [{ id: randomUUID(), testId: firstTestId, sortOrder: 1 }, { id: removedPanelItemId, testId: secondTestId, sortOrder: 2 }] } } });
    const orderCommandValue: OrderCommand = { protocolVersion: 1, operationId: randomUUID(), entityId: randomUUID(), expectedVersion: 0,
      kind: 'order.create', payload: { patientId: patient.id, priority: 'routine', items: [{ panelId }] } };
    const response = await request('/orders/commands', clerk, orderCommandValue); expect(response.status, await response.clone().text()).toBe(200);
    const { order } = await response.json();
    expect(order.items[0].panel.items).toHaveLength(2);
    const manifest = await db.laboratoryOrderTest.findMany({ where: { orderItemId: order.items[0].id }, orderBy: { sortOrder: 'asc' } });
    expect(manifest.map(test => test.testId)).toEqual([firstTestId, secondTestId]);
    await expect(db.laboratoryOrderTest.update({ where: { id: manifest[0]!.id }, data: { testName: 'Tampered' } })).rejects.toThrow('append-only');
    await expect(db.laboratoryOrderTest.delete({ where: { id: manifest[0]!.id } })).rejects.toThrow('append-only');
    await db.laboratoryTest.update({ where: { id: firstTestId }, data: { name: 'Demo changed catalog label',
      analyticalPolicy: { ...originalPolicy, version: 'demo-changed-2', upper: '3' } } });
    await db.panelItem.delete({ where: { id: removedPanelItemId } });
    const storedOrder = await (await request(`/orders/${order.id}`, clerk)).json();
    expect(storedOrder.items[0].panel.items.map((item: { testName: string }) => item.testName))
      .toEqual(['Demo frozen first test', 'Demo frozen second test']);
    const specimenId = randomUUID();
    let commandResponse = await request('/specimens/commands', clerk, specimenCommand(specimenId, 0, 'specimen.create', { orderId: order.id }));
    expect(commandResponse.status, await commandResponse.clone().text()).toBe(200);
    let state = (await commandResponse.json()).specimen;
    for (const kind of ['specimen.collect', 'specimen.receive', 'specimen.accept'] as const) {
      commandResponse = await request('/specimens/commands', technician, specimenCommand(specimenId, state.version, kind));
      expect(commandResponse.status, await commandResponse.clone().text()).toBe(200);
      state = (await commandResponse.json()).specimen;
    }
    const worklist = await (await request('/results/worklist', technician)).json() as Array<{ specimenId: string; testId: string; testName: string; policy: { version: string } }>;
    expect(worklist.filter(item => item.specimenId === specimenId).map(item => [item.testId, item.testName, item.policy.version]))
      .toEqual([[firstTestId, 'Demo frozen first test', 'demo-frozen-1'], [secondTestId, 'Demo frozen second test', 'demo-frozen-1']]);
    const resultResponse = await request('/results/commands', technician, { protocolVersion: 1, operationId: randomUUID(),
      entityId: randomUUID(), expectedVersion: 0, kind: 'result.create', payload: { specimenId, accessionId: state.accession.id,
        orderItemId: order.items[0].id, testId: firstTestId, value: { kind: 'numeric', value: '5', unit: 'demo-unit' } } });
    expect(resultResponse.status, await resultResponse.clone().text()).toBe(200);
    expect((await resultResponse.json()).result).toMatchObject({ testName: 'Demo frozen first test', policy: { version: 'demo-frozen-1' } });
  });
  it('runs valid specimen collection, accession, reject and recollect transitions with audit evidence', async () => {
    const patient = await createPatient();
    const test = ((await (await request('/catalog/tests', clerk)).json()) as Array<{ id: string }>)[0]!;
    const order = orderCommand(patient.id, test.id);
    await request('/orders/commands', clerk, order);
    const specimenId = randomUUID();
    const created = await (await request('/specimens/commands', clerk, specimenCommand(specimenId, 0, 'specimen.create', { orderId: order.entityId }))).json();
    expect(created.specimen.status).toBe('collection_pending'); expect(created.specimen.barcodeValue).toMatch(/^SPM-/);
    expect((await request('/specimens/commands', clerk, specimenCommand(specimenId, 1, 'specimen.accept'))).status).toBe(409);
    let version = 1;
    const collectResponse = await request('/specimens/commands', technician, specimenCommand(specimenId, version, 'specimen.collect')); expect(collectResponse.status).toBe(200); const collect = await collectResponse.json(); version = collect.specimen.version; expect(collect.specimen.status).toBe('collected');
    const receive = await (await request('/specimens/commands', technician, specimenCommand(specimenId, version, 'specimen.receive'))).json(); version = receive.specimen.version; expect(receive.specimen.status).toBe('received_accession_pending'); expect(receive.specimen.accession.identifier).toMatch(/^ACC-/);
    const rejected = await (await request('/specimens/commands', technician, specimenCommand(specimenId, version, 'specimen.reject', { reason: 'Demo insufficient volume' }))).json(); version = rejected.specimen.version; expect(rejected.specimen.status).toBe('rejected'); expect(rejected.specimen.accession.decision).toBe('rejected');
    const recollect = await (await request('/specimens/commands', technician, specimenCommand(specimenId, version, 'specimen.recollect', { reason: 'Demo recollection requested' }))).json(); version = recollect.specimen.version;
    expect(recollect.specimen.status).toBe('recollection_required');
    expect(recollect.specimen.collectedAt).toBe(rejected.specimen.collectedAt);
    expect(recollect.specimen.rejectionReason).toBe('Demo insufficient volume');
    expect(recollect.specimen.accession.id).toBe(rejected.specimen.accession.id);
    expect((await request('/specimens/commands', technician, specimenCommand(specimenId, version, 'specimen.collect'))).status).toBe(409);
    const replacementId = randomUUID();
    const replacement = await (await request('/specimens/commands', technician, specimenCommand(replacementId, 0, 'specimen.create', { orderId: order.entityId }))).json();
    expect(replacement.specimen).toMatchObject({ id: replacementId, attemptNumber: 2, status: 'collection_pending' });
    expect(replacement.specimen.barcodeValue).not.toBe(recollect.specimen.barcodeValue);
    let replacementVersion = replacement.specimen.version;
    const recollected = await (await request('/specimens/commands', technician, specimenCommand(replacementId, replacementVersion, 'specimen.collect'))).json(); replacementVersion = recollected.specimen.version; expect(recollected.specimen.status).toBe('collected');
    const secondReceive = await (await request('/specimens/commands', technician, specimenCommand(replacementId, replacementVersion, 'specimen.receive'))).json(); replacementVersion = secondReceive.specimen.version;
    expect(secondReceive.specimen.accession.identifier).not.toBe(rejected.specimen.accession.identifier);
    const accepted = await (await request('/specimens/commands', technician, specimenCommand(replacementId, replacementVersion, 'specimen.accept'))).json(); expect(accepted.specimen.status).toBe('accepted'); expect(accepted.specimen.accession.decision).toBe('accepted');
    const oldHistory = await (await request(`/specimens/${specimenId}/history`, clerk)).json();
    expect(oldHistory.events.map((event: { toStatus: string }) => event.toStatus)).toEqual(['collection_pending', 'collected', 'received_accession_pending', 'rejected', 'recollection_required']); expect(oldHistory.audit.length).toBe(5);
    const newHistory = await (await request(`/specimens/${replacementId}/history`, clerk)).json();
    expect(newHistory.events.map((event: { toStatus: string }) => event.toStatus)).toEqual(['collection_pending', 'collected', 'received_accession_pending', 'accepted']);
    const fullOrder = await (await request(`/orders/${order.entityId}`, clerk)).json();
    expect(fullOrder.specimens.map((attempt: { id: string; attemptNumber: number }) => [attempt.id, attempt.attemptNumber])).toEqual([[replacementId, 2], [specimenId, 1]]);
    const orderHistory = await (await request(`/orders/${order.entityId}/history`, clerk)).json();
    expect(orderHistory.events).toHaveLength(9);
    expect(orderHistory.audit).toHaveLength(10);
    const oldLookup = await (await request(`/accessions/${rejected.specimen.accession.identifier}`, technician)).json();
    expect(oldLookup).toMatchObject({ id: specimenId, status: 'recollection_required', lookupMatchedAccessionId: rejected.specimen.accession.id, lookupIsHistorical: true });
    expect(oldLookup.accession.decision).toBe('rejected');
    const lookup = await (await request(`/accessions/${accepted.specimen.accession.identifier}`, technician)).json(); expect(lookup.id).toBe(replacementId); expect(lookup.status).toBe('accepted');
    const barcodeLookup = await (await request(`/accessions/${accepted.specimen.barcodeValue}`, technician)).json(); expect(barcodeLookup.id).toBe(replacementId);
  });
  it('rejects invalid transition, stale version and unauthorized workflow mutation', async () => {
    const patient = await createPatient(); const test = ((await (await request('/catalog/tests', clerk)).json()) as Array<{ id: string }>)[0]!; const order = orderCommand(patient.id, test.id); await request('/orders/commands', clerk, order); const specimenId = randomUUID(); await request('/specimens/commands', clerk, specimenCommand(specimenId, 0, 'specimen.create', { orderId: order.entityId }));
    expect((await request('/specimens/commands', approver, specimenCommand(specimenId, 1, 'specimen.collect'))).status).toBe(403);
    expect((await request('/specimens/commands', technician, specimenCommand(specimenId, 99, 'specimen.collect'))).status).toBe(409);
    const original = specimenCommand(specimenId, 1, 'specimen.collect'); const first = await request('/specimens/commands', technician, original); expect(first.status).toBe(200); const replay = await (await request('/specimens/commands', technician, original)).json(); expect(replay.replayed).toBe(true);
  });
  it('requires create version zero and serializes competing specimen transitions', async () => {
    const patient = await createPatient(); const test = ((await (await request('/catalog/tests', clerk)).json()) as Array<{ id: string }>)[0]!; const order = orderCommand(patient.id, test.id); await request('/orders/commands', clerk, order); const specimenId = randomUUID();
    expect((await request('/specimens/commands', clerk, specimenCommand(specimenId, 3, 'specimen.create', { orderId: order.entityId }))).status).toBe(400);
    expect((await request('/specimens/commands', clerk, specimenCommand(specimenId, 0, 'specimen.create', { orderId: order.entityId }))).status).toBe(200);
    const responses = await Promise.all([
      request('/specimens/commands', technician, specimenCommand(specimenId, 1, 'specimen.collect')),
      request('/specimens/commands', technician, specimenCommand(specimenId, 1, 'specimen.collect')),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const history = await (await request(`/specimens/${specimenId}/history`, technician)).json();
    expect(history.events.filter((event: { action: string }) => event.action === 'specimen.collect')).toHaveLength(1);
  });
});

describe('analytical results and synthetic readiness', () => {
  it('reads legacy synthetic seed history without altering immutable evidence', async () => {
    const cmd = command(); const response = await request('/patients/commands', clerk, cmd); expect(response.status).toBe(200);
    await db.patientRevision.create({ data: { patientId: cmd.entityId, version: 2, demographics: { ...demographics, id: cmd.entityId }, actorId: clerk.session.user.id, actorName: 'Demo Legacy Seed' } });
    const history = await request(`/patients/${cmd.entityId}/history`, clerk); expect(history.status).toBe(200);
    expect((await history.json()).revisions[0].demographics).toEqual(demographics);
    expect((await db.patientRevision.findUniqueOrThrow({ where: { patientId_version: { patientId: cmd.entityId, version: 2 } } })).demographics).toHaveProperty('id', cmd.entityId);
  });
  const glucose = '60000000-0000-4000-8000-000000000003';
  const patientId = '70000000-0000-4000-8000-000000000001';
  async function acceptedSlot(testId = glucose, accept = true, panel = false) {
    const orderResponse = await request('/orders/commands', clerk, { protocolVersion: 1, operationId: randomUUID(), entityId: randomUUID(), expectedVersion: 0, kind: 'order.create',
      payload: { patientId, priority: 'routine', items: [panel ? { panelId: '61000000-0000-4000-8000-000000000001' } : { testId }] } });
    expect(orderResponse.status).toBe(200); const { order } = await orderResponse.json();
    const specimenId = randomUUID();
    let response = await request('/specimens/commands', clerk, { protocolVersion: 1, operationId: randomUUID(), entityId: specimenId, expectedVersion: 0, kind: 'specimen.create', payload: { orderId: order.id } });
    expect(response.status).toBe(200); let { specimen } = await response.json();
    for (const kind of ['specimen.collect', 'specimen.receive', accept ? 'specimen.accept' : 'specimen.reject']) {
      response = await request('/specimens/commands', technician, { protocolVersion: 1, operationId: randomUUID(), entityId: specimenId, expectedVersion: specimen.version, kind, payload: kind === 'specimen.reject' ? { reason: 'Synthetic damaged specimen' } : {} });
      expect(response.status).toBe(200); specimen = (await response.json()).specimen;
    }
    return { specimenId, accessionId: specimen.accession.id as string, orderItemId: order.items[0].id as string, testId, specimen };
  }
  function create(slot: Awaited<ReturnType<typeof acceptedSlot>>, value: ResultValue = { kind: 'numeric', value: '15', unit: 'mmol/L' }): ResultCommand {
    return { protocolVersion: 1, operationId: randomUUID(), entityId: randomUUID(), expectedVersion: 0, kind: 'result.create',
      payload: { specimenId: slot.specimenId, accessionId: slot.accessionId, orderItemId: slot.orderItemId, testId: slot.testId, value } };
  }
  async function submit(command: ResultCommand, client = technician): Promise<AnalyticalResult> {
    const response = await request('/results/commands', client, command);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()).result;
  }
  const transition = (result: AnalyticalResult, kind: ResultCommand['kind'], payload: unknown = {}): ResultCommand => ({
    protocolVersion: 1, operationId: randomUUID(), entityId: result.id, expectedVersion: result.version, kind, payload,
  } as ResultCommand);

  it('enforces technician write, approver read and clerk/admin denial, including direct commands', async () => {
    const cmd = create(await acceptedSlot()); const result = await submit(cmd);
    expect((await request('/results/worklist', technician)).status).toBe(200);
    expect((await request(`/results/${result.id}`, approver)).status).toBe(200);
    for (const user of [clerk, admin]) expect((await request(`/results/${result.id}`, user)).status).toBe(403);
    for (const user of [clerk, approver, admin]) expect((await request('/results/commands', user, cmd)).status).toBe(403);
    expect((await request('/results')).status).toBe(401);
    expect((await request('/results/commands', technician, transition(result, 'result.enter'), { 'x-csrf-token': '' })).status).toBe(403);
  });

  it('preserves lifecycle, QC blocking, revisions and audit as separate server evidence', async () => {
    let state = await submit(create(await acceptedSlot()));
    expect(state).toMatchObject({ status: 'draft', version: 1, validation: { outcome: 'not_run' }, qc: { status: 'missing' } });
    expect((await request('/results/commands', technician, transition(state, 'result.readiness'))).status).toBe(409);
    state = await submit(transition(state, 'result.enter'));
    state = await submit(transition(state, 'result.validate')); expect(state.validation).toMatchObject({ outcome: 'passed', flag: 'normal', critical: 'none' });
    state = await submit(transition(state, 'result.readiness')); expect(state).toMatchObject({ status: 'validated', readiness: 'blocked' });
    state = await submit(transition(state, 'result.qc', { status: 'fail', reason: 'Synthetic control failed' }));
    state = await submit(transition(state, 'result.readiness')); expect(state.status).toBe('validated');
    state = await submit(transition(state, 'result.qc', { status: 'pass', reason: 'Synthetic control repeated' }));
    state = await submit(transition(state, 'result.readiness')); expect(state).toMatchObject({ status: 'analytically_ready', readiness: 'ready' });
    state = await submit(transition(state, 'result.qc', { status: 'fail', reason: 'Synthetic evidence withdrawn' }));
    expect(state).toMatchObject({ status: 'validated', readiness: 'blocked' });
    const history = await (await request(`/results/${state.id}/history`, technician)).json();
    expect(history.revisions).toHaveLength(state.version);
    expect(history.revisions[0].previousVersion).toBe(state.version - 1);
    expect(history.audit.some((event: { action: string }) => event.action === 'result.readiness.blocked')).toBe(true);
    expect(history.audit.some((event: { action: string }) => event.action === 'result.validation.passed')).toBe(true);
  });

  it('rejects unaccepted/recollection specimens, wrong accession and forged test membership', async () => {
    const rejected = await acceptedSlot(glucose, false);
    expect((await request('/results/commands', technician, create(rejected))).status).toBe(409);
    const recollect = await request('/specimens/commands', technician, { protocolVersion: 1, operationId: randomUUID(), entityId: rejected.specimenId, expectedVersion: rejected.specimen.version, kind: 'specimen.recollect', payload: { reason: 'Synthetic recollection required' } });
    expect(recollect.status).toBe(200);
    expect((await request('/results/commands', technician, create(rejected))).status).toBe(409);
    const accepted = await acceptedSlot();
    expect((await request('/results/commands', technician, create({ ...accepted, accessionId: rejected.accessionId }))).status).toBe(409);
    expect((await request('/results/commands', technician, create({ ...accepted, testId: '60000000-0000-4000-8000-000000000001' }))).status).toBe(400);
    expect((await request('/results/commands', technician, create({ ...accepted, orderItemId: rejected.orderItemId }))).status).toBe(400);
  });

  it('expands panels to independent test slots and forbids duplicate result slots', async () => {
    const slot = await acceptedSlot('60000000-0000-4000-8000-000000000001', true, true);
    const worklist = await (await request('/results/worklist', technician)).json();
    expect(worklist.filter((item: { specimenId: string }) => item.specimenId === slot.specimenId)).toHaveLength(2);
    await submit(create(slot, { kind: 'numeric', value: '15', unit: 'g/dL' }));
    expect((await request('/results/commands', technician, create(slot))).status).toBe(409);
    await submit(create({ ...slot, testId: '60000000-0000-4000-8000-000000000002' }, { kind: 'numeric', value: '15', unit: '10^9/L' }));
  });

  it('idempotently replays, rejects changed replay and serializes competing expected versions', async () => {
    const cmd = create(await acceptedSlot()); let state = await submit(cmd);
    const beforeAudit = await db.auditEvent.count({ where: { entityId: state.id } });
    const replay = await request('/results/commands', technician, cmd); expect((await replay.json()).replayed).toBe(true);
    expect(await db.resultRevision.count({ where: { resultId: state.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: state.id } })).toBe(beforeAudit);
    expect((await request('/results/commands', technician, { ...cmd, entityId: randomUUID() })).status).toBe(409);
    const stale = transition(state, 'result.enter');
    const responses = await Promise.all([request('/results/commands', technician, stale), request('/results/commands', technician, transition(state, 'result.revise', { value: { kind: 'numeric', value: '16', unit: 'mmol/L' }, reason: 'Competing correction' }))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await request('/results/commands', technician, { ...stale, operationId: randomUUID() })).status).toBe(409);
    state = await (await request(`/results/${state.id}`, technician)).json(); expect(state.version).toBe(2);
  });

  it('retains critical evidence across correction and resets validation and QC', async () => {
    let state = await submit(create(await acceptedSlot(), { kind: 'numeric', value: '40', unit: 'mmol/L' }));
    state = await submit(transition(state, 'result.enter')); state = await submit(transition(state, 'result.validate'));
    expect(state).toMatchObject({ criticalReviewRequired: true, validation: { critical: 'high' } });
    state = await submit(transition(state, 'result.qc', { status: 'pass', reason: 'Synthetic attestation' }));
    state = await submit(transition(state, 'result.readiness')); expect(state.criticalReviewRequired).toBe(true);
    state = await submit(transition(state, 'result.revise', { value: { kind: 'numeric', value: '15', unit: 'mmol/L' }, reason: 'Synthetic transcription correction' }));
    expect(state).toMatchObject({ status: 'draft', validation: { outcome: 'not_run' }, readiness: 'pending', qc: { status: 'missing' } });
    const history = await (await request(`/results/${state.id}/history`, approver)).json();
    expect(history.revisions.some((revision: { snapshot: AnalyticalResult }) => revision.snapshot.criticalReviewRequired)).toBe(true);
    expect(history.audit.some((event: { action: string }) => event.action === 'result.critical.high')).toBe(true);
  });

  it('stores exact numeric precision and rejects invalid units/type/format before advancing', async () => {
    const precise = '9007199254740993.000000000000000001';
    let state = await submit(create(await acceptedSlot(), { kind: 'numeric', value: precise, unit: 'mmol/L' }));
    expect((await db.analyticalResult.findUniqueOrThrow({ where: { id: state.id } })).numericValue!.toFixed(18)).toBe(precise);
    expect(state.value.value).toBe(precise);
    for (const value of [{ kind: 'numeric', value: '15', unit: 'wrong' }, { kind: 'text', value: '15', unit: 'mmol/L' }, { kind: 'numeric', value: 'NaN', unit: 'mmol/L' }]) {
      state = await submit(transition(state, 'result.revise', { value, reason: 'Synthetic invalid candidate' }));
      state = await submit(transition(state, 'result.enter')); state = await submit(transition(state, 'result.validate'));
      expect(state).toMatchObject({ status: 'entered', validation: { outcome: 'failed' }, readiness: 'blocked' });
      expect((await request('/results/commands', technician, transition(state, 'result.readiness'))).status).toBe(409);
    }
  });

  it('supports coded and text results with independent synthetic policies', async () => {
    for (const [testId, value] of [['60000000-0000-4000-8000-000000000004', { kind: 'coded', value: 'DEMO_NEGATIVE' }], ['60000000-0000-4000-8000-000000000005', { kind: 'text', value: 'Demo observation' }]] as [string, ResultValue][]) {
      let state = await submit(create(await acceptedSlot(testId), value));
      state = await submit(transition(state, 'result.enter')); state = await submit(transition(state, 'result.validate'));
      expect(state.validation.outcome).toBe('passed'); expect(state.value).toEqual(value);
    }
  });

  it('prevents editing/deleting revision evidence and preserves policy snapshots', async () => {
    let state = await submit(create(await acceptedSlot()));
    const revision = await db.resultRevision.findUniqueOrThrow({ where: { resultId_version: { resultId: state.id, version: 1 } } });
    await expect(db.resultRevision.update({ where: { id: revision.id }, data: { actorName: 'Tampered' } })).rejects.toThrow('append-only');
    await expect(db.resultRevision.delete({ where: { id: revision.id } })).rejects.toThrow('append-only');
    await expect(db.resultRevision.create({ data: { ...revision, id: randomUUID(), version: 3, previousRevisionId: revision.id } })).rejects.toThrow('previous version');
    const test = await db.laboratoryTest.findUniqueOrThrow({ where: { id: glucose } });
    try {
      await db.laboratoryTest.update({ where: { id: glucose }, data: { analyticalPolicy: { ...state.policy, version: 'changed-demo', lower: '100', upper: '200' } } });
      state = await submit(transition(state, 'result.enter')); state = await submit(transition(state, 'result.validate'));
      expect(state.policy.version).toBe('synthetic-demo-v1'); expect(state.validation.flag).toBe('normal');
    } finally { await db.laboratoryTest.update({ where: { id: glucose }, data: { analyticalPolicy: test.analyticalPolicy! } }); }
  });

  it('denies cross-facility reads, history, worklist leakage and creation even for technicians', async () => {
    const slot = await acceptedSlot(); const result = await submit(create(slot));
    await db.user.update({ where: { id: other.session.user.id }, data: { role: 'technician' } });
    try {
      const otherTech = await login('other-clerk');
      for (const path of [`/results/${result.id}`, `/results/${result.id}/history`]) expect((await request(path, otherTech)).status).toBe(404);
      expect((await request('/results/commands', otherTech, create(slot))).status).toBe(404);
      expect((await request('/results/commands', otherTech, transition(result, 'result.enter'))).status).toBe(404);
      const list = await (await request('/results/worklist', otherTech)).json(); expect(list.some((item: { specimenId: string }) => item.specimenId === slot.specimenId)).toBe(false);
    } finally { await db.user.update({ where: { id: other.session.user.id }, data: { role: 'registration_clerk' } }); }
  });
});
