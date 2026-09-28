import { describe, expect, it } from 'vitest';
import { PatientCommandSchema, PatientDemographicsSchema, ResultCommandSchema, ResultValueSchema, ROLE_PERMISSIONS } from './index';
const demographics = {displayName:'Demo Patient 01', dateOfBirth:'1990-02-28', sex:'unknown', preferredLanguage:'en', synthetic:true};
describe('clinical data boundary', () => {
  it('accepts explicitly synthetic demographics but rejects false dates and extra fields', () => {
    expect(PatientDemographicsSchema.safeParse(demographics).success).toBe(true);
    for (const change of [{dateOfBirth:'2025-02-29'}, {dateOfBirth:'2999-01-01'}, {synthetic:false}, {displayName:'Real Person'}, {diagnosis:'none'}])
      expect(PatientDemographicsSchema.safeParse({...demographics,...change}).success).toBe(false);
  });
  it('separates creation and update version preconditions', () => {
    const base={protocolVersion:1,operationId:crypto.randomUUID(),entityId:crypto.randomUUID(),kind:'patient.create',expectedVersion:0,payload:demographics};
    expect(PatientCommandSchema.safeParse(base).success).toBe(true);
    expect(PatientCommandSchema.safeParse({...base, expectedVersion:1}).success).toBe(false);
    expect(PatientCommandSchema.safeParse({...base,kind:'patient.update'}).success).toBe(false);
  });
  it('never inherits clinical access from administrator membership', () => {
    expect(ROLE_PERMISSIONS.administrator).toEqual(['admin:read']);
    expect(ROLE_PERMISSIONS.technician).not.toContain('patient:write');
  });
});

describe('analytical command boundary', () => {
  const base = () => ({
    protocolVersion: 1, operationId: crypto.randomUUID(), entityId: crypto.randomUUID(), expectedVersion: 1,
  });
  const value = { kind: 'numeric', value: '9007199254740993.000000000000000001', unit: 'demo-unit' };
  const create = () => ({
    ...base(), kind: 'result.create', expectedVersion: 0,
    payload: {
      specimenId: crypto.randomUUID(), accessionId: crypto.randomUUID(),
      orderItemId: crypto.randomUUID(), testId: crypto.randomUUID(), value,
    },
  });

  it('preserves exact decimal strings without coercing numeric JSON values', () => {
    const parsed = ResultCommandSchema.parse(create());
    expect(parsed.kind).toBe('result.create');
    if (parsed.kind !== 'result.create') throw new Error('Unexpected command variant');
    expect(parsed.payload.value).toEqual(value);
    expect(ResultValueSchema.safeParse({ ...value, value: 9007199254740992 }).success).toBe(false);
    expect(ResultValueSchema.parse({ kind: 'numeric', value: '-0.0000', unit: 'demo-unit' }).value).toBe('-0.0000');
  });

  it('retains incomplete draft input for later authoritative validation', () => {
    for (const draft of [
      { kind: 'numeric', value: '' },
      { kind: 'numeric', value: 'not a decimal' },
      { kind: 'text', value: 'Synthetic observation' },
      { kind: 'coded', value: 'demo_present' },
    ]) expect(ResultValueSchema.parse(draft)).toEqual(draft);
    expect(ResultValueSchema.safeParse({ kind: 'boolean', value: 'true' }).success).toBe(false);
    expect(ResultValueSchema.safeParse({ kind: 'numeric', value: '1', numericValue: 1 }).success).toBe(false);
  });

  it('requires an accession and order-item/test linkage for result creation', () => {
    const command = create();
    expect(ResultCommandSchema.safeParse(command).success).toBe(true);
    for (const field of ['specimenId', 'accessionId', 'orderItemId', 'testId']) {
      expect(ResultCommandSchema.safeParse({ ...command, payload: { ...command.payload, [field]: undefined } }).success).toBe(false);
      expect(ResultCommandSchema.safeParse({ ...command, payload: { ...command.payload, [field]: 'not-a-uuid' } }).success).toBe(false);
    }
  });

  it('requires version zero only for creation and a positive integer for every existing-result command', () => {
    expect(ResultCommandSchema.safeParse({ ...create(), expectedVersion: 1 }).success).toBe(false);
    const variants = [
      { kind: 'result.revise', payload: { value, reason: 'Correct synthetic transcription' } },
      { kind: 'result.enter', payload: {} },
      { kind: 'result.validate', payload: {} },
      { kind: 'result.qc', payload: { status: 'pass', reason: 'Manual demo QC attestation' } },
      { kind: 'result.readiness', payload: {} },
    ];
    for (const variant of variants) {
      const command = { ...base(), ...variant };
      expect(ResultCommandSchema.safeParse(command).success).toBe(true);
      for (const expectedVersion of [0, -1, 1.5, '1']) {
        expect(ResultCommandSchema.safeParse({ ...command, expectedVersion }).success).toBe(false);
      }
    }
  });

  it('does not accept client-assigned authority, policy, evaluation or lifecycle state', () => {
    const command = create();
    for (const field of ['facilityId', 'patientId', 'orderId', 'enteredBy', 'status', 'policy', 'validation', 'criticalReviewRequired']) {
      expect(ResultCommandSchema.safeParse({ ...command, [field]: 'forged' }).success).toBe(false);
      expect(ResultCommandSchema.safeParse({ ...command, payload: { ...command.payload, [field]: 'forged' } }).success).toBe(false);
    }
    for (const kind of ['result.enter', 'result.validate', 'result.readiness']) {
      expect(ResultCommandSchema.safeParse({ ...base(), kind, payload: { status: 'analytically_ready' } }).success).toBe(false);
    }
    expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.approve', payload: {} }).success).toBe(false);
    expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.release', payload: {} }).success).toBe(false);
  });

  it('requires reasoned corrections and explicit manual QC decisions', () => {
    for (const reason of ['', '  ', 'ab']) {
      expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.revise', payload: { value, reason } }).success).toBe(false);
      expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.qc', payload: { status: 'pass', reason } }).success).toBe(false);
    }
    expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.qc', payload: { status: 'missing', reason: 'demo check' } }).success).toBe(false);
    expect(ResultCommandSchema.safeParse({ ...base(), kind: 'result.qc', payload: { status: 'pass', reason: 'demo check', checkedBy: crypto.randomUUID() } }).success).toBe(false);
  });

  it('keeps analytical writing separate from review and administration', () => {
    expect(ROLE_PERMISSIONS.technician).toContain('result:read');
    expect(ROLE_PERMISSIONS.technician).toContain('result:write');
    expect(ROLE_PERMISSIONS.technician).not.toContain('review:read');
    expect(ROLE_PERMISSIONS.qualified_approver).toContain('result:read');
    expect(ROLE_PERMISSIONS.qualified_approver).toContain('review:read');
    expect(ROLE_PERMISSIONS.qualified_approver).not.toContain('result:write');
    expect(ROLE_PERMISSIONS.qualified_approver).not.toContain('admin:read');
    expect(ROLE_PERMISSIONS.registration_clerk).not.toContain('result:write');
    expect(ROLE_PERMISSIONS.administrator).toEqual(['admin:read']);
  });
});
