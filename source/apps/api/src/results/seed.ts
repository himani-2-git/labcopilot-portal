import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ROLE_PERMISSIONS, type AnalyticalResult, type ResultCommand, type SessionUser } from '@labcopilot/contracts';
import type { DatabaseService } from '../database';
import { FACILITY_A } from '../seed';
import { DEMO_PATIENTS, DEMO_TESTS } from '../laboratory/seed';
import { LaboratoryService } from '../laboratory/laboratory.service';
import { ResultsService } from './results.service';

/** Uses the normal command path so fixtures include genuine revisions and audit evidence. */
export async function seedDemoResults(db: PrismaClient) {
  const clerk: SessionUser = { id: '11111111-1111-4111-8111-111111111111', username: 'clerk', displayName: 'Demo Registration Clerk', role: 'registration_clerk', facilityId: FACILITY_A, facilityName: 'Demo District Laboratory', permissions: ROLE_PERMISSIONS.registration_clerk };
  const technician: SessionUser = { ...clerk, id: '22222222-2222-4222-8222-222222222222', username: 'technician', displayName: 'Demo Technician', role: 'technician', permissions: ROLE_PERMISSIONS.technician };
  const lab = new LaboratoryService(db as DatabaseService); const results = new ResultsService(db as DatabaseService);
  const examples = [
    { name: 'Normal and analytically ready', value: '15', qc: 'pass', ready: true },
    { name: 'Low synthetic flag', value: '5', qc: 'pass' },
    { name: 'High synthetic flag', value: '25', qc: 'pass' },
    { name: 'Critical synthetic flag — future review required', value: '45', qc: 'pass', ready: true },
    { name: 'Invalid numeric entry', value: 'not-a-number' },
    { name: 'QC blocked', value: '15', qc: 'fail', ready: true },
    { name: 'Correction with retained critical history', value: '45', correction: '15', qc: 'pass', ready: true },
    { name: 'Coded synthetic result', value: 'DEMO_NEGATIVE', testId: DEMO_TESTS.urinalysis, kind: 'coded' },
    { name: 'Text synthetic result', value: 'Demo observation recorded', testId: DEMO_TESTS.note, kind: 'text' },
  ] as const;
  for (const [index, example] of examples.entries()) {
    const suffix = String(index + 1).padStart(12, '0');
    const resultId = `85000000-0000-4000-8000-${suffix}`;
    if (await db.analyticalResult.findUnique({ where: { id: resultId } })) continue;
    const orderId = `81000000-0000-4000-8000-${suffix}`;
    const specimenId = `82${String(index + 1).padStart(6, '0')}-0000-4000-8000-${suffix}`;
    const testId = 'testId' in example ? example.testId : DEMO_TESTS.glucose;
    let order = await db.laboratoryOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) {
      await lab.orderCommand(clerk, { protocolVersion: 1, operationId: randomUUID(), entityId: orderId, expectedVersion: 0, kind: 'order.create',
        payload: { patientId: index % 2 ? DEMO_PATIENTS.two : DEMO_PATIENTS.one, priority: 'routine', note: `Synthetic Phase 3: ${example.name}`, items: [{ testId }] } }, randomUUID());
      order = await db.laboratoryOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    }
    let specimen = await db.specimen.findUnique({ where: { id: specimenId } });
    if (!specimen) {
      await lab.specimenCommand(clerk, { protocolVersion: 1, operationId: randomUUID(), entityId: specimenId, expectedVersion: 0, kind: 'specimen.create', payload: { orderId } }, randomUUID());
      specimen = await db.specimen.findUniqueOrThrow({ where: { id: specimenId } });
    }
    while (['collection_pending', 'collected', 'received_accession_pending'].includes(specimen.status)) {
      const kind = specimen.status === 'collection_pending' ? 'specimen.collect' : specimen.status === 'collected' ? 'specimen.receive' : 'specimen.accept';
      await lab.specimenCommand(technician, { protocolVersion: 1, operationId: randomUUID(), entityId: specimenId, expectedVersion: specimen.version, kind, payload: {} }, randomUUID());
      specimen = await db.specimen.findUniqueOrThrow({ where: { id: specimenId } });
    }
    const accession = await db.accession.findFirstOrThrow({ where: { specimenId }, orderBy: { receivedAt: 'desc' } });
    const value = { kind: 'kind' in example ? example.kind : 'numeric' as const, value: example.value, ...(!('kind' in example) ? { unit: 'mmol/L' } : {}) };
    let state = (await results.command(technician, { protocolVersion: 1, operationId: randomUUID(), entityId: resultId, expectedVersion: 0, kind: 'result.create',
      payload: { specimenId, accessionId: accession.id, orderItemId: order.items[0]!.id, testId, value } }, randomUUID())).result!;
    const send = async (kind: ResultCommand['kind'], payload: unknown = {}) => {
      const command = { protocolVersion: 1, operationId: randomUUID(), entityId: resultId, expectedVersion: state.version, kind, payload } as ResultCommand;
      state = (await results.command(technician, command, randomUUID())).result as AnalyticalResult;
    };
    await send('result.enter'); await send('result.validate');
    if ('correction' in example) {
      await send('result.revise', { value: { ...value, value: example.correction }, reason: 'Synthetic transcription correction; retain prior critical evidence.' });
      await send('result.enter'); await send('result.validate');
    }
    if ('qc' in example) await send('result.qc', { status: example.qc, reason: `Synthetic manual QC attestation: ${example.qc}. No instrument control measurement.` });
    if ('ready' in example) await send('result.readiness');
  }
}
