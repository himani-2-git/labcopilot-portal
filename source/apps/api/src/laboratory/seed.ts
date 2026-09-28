import type { PrismaClient, Prisma } from '@prisma/client';
import { FACILITY_A } from '../seed';
import { syntheticPolicy } from '../results/rules';

export const DEMO_TESTS = {
  hemoglobin: '60000000-0000-4000-8000-000000000001',
  whiteCell: '60000000-0000-4000-8000-000000000002',
  glucose: '60000000-0000-4000-8000-000000000003',
  urinalysis: '60000000-0000-4000-8000-000000000004',
  note: '60000000-0000-4000-8000-000000000005',
};
export const DEMO_PANEL = '61000000-0000-4000-8000-000000000001';
export const DEMO_PATIENTS = {
  one: '70000000-0000-4000-8000-000000000001',
  two: '70000000-0000-4000-8000-000000000002',
};
export const DEMO_ORDERS = {
  one: '71000000-0000-4000-8000-000000000001',
  two: '71000000-0000-4000-8000-000000000002',
};
export const DEMO_SPECIMENS = {
  one: '72000000-0000-4000-8000-000000000001',
  two: '72000000-0000-4000-8000-000000000002',
};

export async function seedDemoCatalog(db: PrismaClient) {
  const tests = [
    { id: DEMO_TESTS.hemoglobin, code: 'DEMO-HGB', name: 'Hemoglobin (demo)', specimenType: 'whole_blood', unit: 'g/dL', referenceMetadata: 'Synthetic demonstration metadata only.' },
    { id: DEMO_TESTS.whiteCell, code: 'DEMO-WBC', name: 'White cell count (demo)', specimenType: 'whole_blood', unit: '10^9/L', referenceMetadata: 'Synthetic demonstration metadata only.' },
    { id: DEMO_TESTS.glucose, code: 'DEMO-GLU', name: 'Glucose (demo)', specimenType: 'serum', unit: 'mmol/L', referenceMetadata: 'Synthetic demonstration metadata only.' },
    { id: DEMO_TESTS.urinalysis, code: 'DEMO-URI', name: 'Urinalysis screen (demo)', specimenType: 'urine', referenceMetadata: 'Synthetic demonstration metadata only.' },
    { id: DEMO_TESTS.note, code: 'DEMO-NOTE', name: 'Specimen observation (demo)', specimenType: 'serum', referenceMetadata: 'Synthetic free-text demonstration only.' },
  ];
  for (const test of tests) {
    const analyticalPolicy = syntheticPolicy(test.id === DEMO_TESTS.urinalysis ? 'coded' : test.id === DEMO_TESTS.note ? 'text' : 'numeric', test.unit) as unknown as Prisma.InputJsonValue;
    await db.laboratoryTest.upsert({ where: { id: test.id }, create: { ...test, analyticalPolicy }, update: { ...test, analyticalPolicy, status: 'active' } });
  }
  await db.laboratoryPanel.upsert({ where: { id: DEMO_PANEL }, create: { id: DEMO_PANEL, code: 'DEMO-CBC', name: 'Demo blood count panel', description: 'Synthetic panel for demonstrating pre-analytical workflow.', items: { create: [{ id: '62000000-0000-4000-8000-000000000001', testId: DEMO_TESTS.hemoglobin, sortOrder: 1 }, { id: '62000000-0000-4000-8000-000000000002', testId: DEMO_TESTS.whiteCell, sortOrder: 2 }] } }, update: { name: 'Demo blood count panel', description: 'Synthetic panel for demonstrating pre-analytical workflow.', status: 'active' } });

  const clerkId = '11111111-1111-4111-8111-111111111111';
  const patientData = [
    { id: DEMO_PATIENTS.one, displayName: 'Demo Patient 001', dateOfBirth: '1988-04-12', sex: 'female' as const },
    { id: DEMO_PATIENTS.two, displayName: 'Demo Patient 002', dateOfBirth: '1979-11-23', sex: 'male' as const },
  ];
  for (const patient of patientData) {
    const existing = await db.patient.findUnique({ where: { id: patient.id } });
    const demographics = { displayName: patient.displayName, dateOfBirth: patient.dateOfBirth, sex: patient.sex, preferredLanguage: 'en' as const, synthetic: true };
    if (!existing) {
      await db.patient.create({ data: { id: patient.id, facilityId: FACILITY_A, version: 1, demographics } });
      await db.patientRevision.create({ data: { patientId: patient.id, version: 1, demographics, actorId: clerkId, actorName: 'Demo Registration Clerk' } });
      await db.auditEvent.create({ data: { facilityId: FACILITY_A, actorId: clerkId, actorName: 'Demo Registration Clerk', action: 'patient.seed', entityId: patient.id, version: 1, correlationId: patient.id } });
    } else await db.patient.update({ where: { id: patient.id }, data: { demographics } });
  }
  const frozenTest = async (id: string, sortOrder: number) => {
    const test = await db.laboratoryTest.findUniqueOrThrow({ where: { id } });
    return { id: id === DEMO_TESTS.hemoglobin ? '76000000-0000-4000-8000-000000000001'
      : id === DEMO_TESTS.whiteCell ? '76000000-0000-4000-8000-000000000002'
        : '76000000-0000-4000-8000-000000000003',
      testId: test.id, sortOrder, testCode: test.code, testName: test.name, specimenType: test.specimenType,
      unit: test.unit, referenceMetadata: test.referenceMetadata, loincCode: test.loincCode,
      ...(test.analyticalPolicy !== null ? { analyticalPolicy: test.analyticalPolicy as Prisma.InputJsonValue } : {}) };
  };
  const orderOne = await db.laboratoryOrder.findUnique({ where: { id: DEMO_ORDERS.one } });
  if (!orderOne) {
    await db.laboratoryOrder.create({ data: { id: DEMO_ORDERS.one, facilityId: FACILITY_A, patientId: DEMO_PATIENTS.one, orderedById: clerkId, version: 1, priority: 'routine', items: { create: { id: '73000000-0000-4000-8000-000000000001', itemType: 'panel', panelId: DEMO_PANEL,
      catalogCode: 'DEMO-CBC', catalogName: 'Demo blood count panel',
      orderedTests: { create: [await frozenTest(DEMO_TESTS.hemoglobin, 1), await frozenTest(DEMO_TESTS.whiteCell, 2)] } } } } });
    await db.auditEvent.create({ data: { facilityId: FACILITY_A, actorId: clerkId, actorName: 'Demo Registration Clerk', action: 'order.seed', entityId: DEMO_ORDERS.one, version: 1, correlationId: DEMO_ORDERS.one } });
  }
  const orderTwo = await db.laboratoryOrder.findUnique({ where: { id: DEMO_ORDERS.two } });
  if (!orderTwo) {
    await db.laboratoryOrder.create({ data: { id: DEMO_ORDERS.two, facilityId: FACILITY_A, patientId: DEMO_PATIENTS.two, orderedById: clerkId, version: 1, priority: 'urgent', items: { create: { id: '73000000-0000-4000-8000-000000000002', itemType: 'test', testId: DEMO_TESTS.glucose,
      catalogCode: 'DEMO-GLU', catalogName: 'Glucose (demo)', orderedTests: { create: await frozenTest(DEMO_TESTS.glucose, 1) } } } } });
    await db.auditEvent.create({ data: { facilityId: FACILITY_A, actorId: clerkId, actorName: 'Demo Registration Clerk', action: 'order.seed', entityId: DEMO_ORDERS.two, version: 1, correlationId: DEMO_ORDERS.two } });
  }
  const specimenOne = await db.specimen.findUnique({ where: { id: DEMO_SPECIMENS.one } });
  if (!specimenOne) {
    await db.specimen.create({ data: { id: DEMO_SPECIMENS.one, facilityId: FACILITY_A, patientId: DEMO_PATIENTS.one, orderId: DEMO_ORDERS.one, version: 1, specimenType: 'whole_blood', status: 'collection_pending', barcodeValue: 'SPM-DEMO0001' } });
    await db.specimenEvent.create({ data: { id: '74000000-0000-4000-8000-000000000001', facilityId: FACILITY_A, specimenId: DEMO_SPECIMENS.one, actorId: clerkId, toStatus: 'collection_pending', action: 'specimen.seed', correlationId: DEMO_SPECIMENS.one } });
  }
  const specimenTwo = await db.specimen.findUnique({ where: { id: DEMO_SPECIMENS.two } });
  if (!specimenTwo) {
    await db.specimen.create({ data: { id: DEMO_SPECIMENS.two, facilityId: FACILITY_A, patientId: DEMO_PATIENTS.two, orderId: DEMO_ORDERS.two, version: 3, specimenType: 'serum', status: 'accepted', barcodeValue: 'SPM-DEMO0002', collectedAt: new Date(), collectedById: clerkId, receivedAt: new Date(), receivedById: clerkId } });
    await db.accession.create({ data: { id: '75000000-0000-4000-8000-000000000001', facilityId: FACILITY_A, identifier: 'ACC-DEMO0002', barcodeValue: 'SPM-DEMO0002', specimenId: DEMO_SPECIMENS.two, orderId: DEMO_ORDERS.two, patientId: DEMO_PATIENTS.two, receivedAt: new Date(), receivedById: clerkId, decision: 'accepted' } });
    await db.specimenEvent.createMany({ data: [{ id: '74000000-0000-4000-8000-000000000002', facilityId: FACILITY_A, specimenId: DEMO_SPECIMENS.two, actorId: clerkId, toStatus: 'collection_pending', action: 'specimen.seed', correlationId: DEMO_SPECIMENS.two }, { id: '74000000-0000-4000-8000-000000000003', facilityId: FACILITY_A, specimenId: DEMO_SPECIMENS.two, actorId: clerkId, fromStatus: 'collection_pending', toStatus: 'collected', action: 'specimen.seed.collect', correlationId: DEMO_SPECIMENS.two }, { id: '74000000-0000-4000-8000-000000000004', facilityId: FACILITY_A, specimenId: DEMO_SPECIMENS.two, actorId: clerkId, fromStatus: 'collected', toStatus: 'received_accession_pending', action: 'specimen.seed.receive', correlationId: DEMO_SPECIMENS.two }, { id: '74000000-0000-4000-8000-000000000005', facilityId: FACILITY_A, specimenId: DEMO_SPECIMENS.two, actorId: clerkId, fromStatus: 'received_accession_pending', toStatus: 'accepted', action: 'specimen.seed.accept', correlationId: DEMO_SPECIMENS.two }] });
  }
}
