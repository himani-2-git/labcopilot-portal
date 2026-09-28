import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { ResultPolicy, ResultValue, ResultValidation } from '@labcopilot/contracts';
const require = createRequire(import.meta.url);
const { exactDecimal, validateResult, syntheticPolicy } = require('../dist/results/rules.js') as {
  exactDecimal: (value: string) => { toFixed: (places: number) => string } | null;
  validateResult: (value: ResultValue, policy: ResultPolicy, at: string) => ResultValidation;
  syntheticPolicy: (kind: ResultValue['kind'], unit?: string) => ResultPolicy;
};
const policy = syntheticPolicy('numeric', 'demo-unit');
const check = (value: string) => validateResult({ kind: 'numeric', value, unit: 'demo-unit' }, policy, '2026-09-23T00:00:00Z');
describe('exact synthetic deterministic rules', () => {
  it.each([['10', 'normal', 'none'], ['20', 'normal', 'none'], ['9.999999999999999999', 'low', 'none'],
    ['20.000000000000000001', 'high', 'none'], ['2', 'low', 'low'], ['40', 'high', 'high']])('evaluates %s without binary rounding', (value, flag, critical) => {
    expect(check(value!)).toMatchObject({ outcome: 'passed', flag, critical });
  });
  it.each(['', '1e3', 'NaN', 'Infinity', ' 15 ', '+15', '.5', '1,000', '01', '1.0000000000000000001', '100000000000000000000'])('rejects unsupported decimal form %s', value => {
    expect(check(value).outcome).toBe('failed'); expect(check(value).flag).toBe('not_evaluated');
  });
  it('round-trips beyond binary safe integer and preserves the last fractional digit', () => {
    const value = '9007199254740993.000000000000000001';
    expect(exactDecimal(value)?.toFixed(18)).toBe(value); expect(check(value).critical).toBe('high');
  });
  it('does not classify missing reference metadata as normal', () => {
    expect(validateResult({ kind: 'numeric', value: '15' }, { version: 'demo', label: 'Synthetic', synthetic: true, valueKind: 'numeric' }, '').flag).toBe('not_applicable');
  });
  it('separates wrong units and value kinds from reference flags', () => {
    expect(validateResult({ kind: 'text', value: '15', unit: 'other' }, policy, '').issues.map(issue => issue.code)).toEqual(['VALUE_TYPE', 'UNIT_MISMATCH']);
  });
  it('validates qualitative codes and treats free text as uninterpreted', () => {
    expect(validateResult({ kind: 'coded', value: 'DEMO_POSITIVE' }, syntheticPolicy('coded'), '')).toMatchObject({ outcome: 'passed', flag: 'abnormal', critical: 'none' });
    expect(validateResult({ kind: 'coded', value: 'unknown' }, syntheticPolicy('coded'), '').outcome).toBe('failed');
    expect(validateResult({ kind: 'text', value: 'Demo observation' }, syntheticPolicy('text'), '')).toMatchObject({ outcome: 'passed', flag: 'not_applicable' });
  });
});
