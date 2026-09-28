import { Prisma } from '@prisma/client';
import type { ResultPolicy, ResultValidation, ResultValue } from '@labcopilot/contracts';

// Bound the lexical form before Decimal/NUMERIC conversion. No coercion, rounding,
// scientific notation or binary floating-point participates in rule evaluation.
export const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;
export function exactDecimal(value: string): Prisma.Decimal | null {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value) ? new Prisma.Decimal(value) : null;
}
export function validateResult(value: ResultValue, policy: ResultPolicy, evaluatedAt: string): ResultValidation {
  const issues: ResultValidation['issues'] = [];
  if (!value.value.trim()) issues.push({ code: 'VALUE_REQUIRED', message: 'Enter a result value.' });
  if (value.kind !== policy.valueKind) issues.push({ code: 'VALUE_TYPE', message: `This synthetic test requires a ${policy.valueKind} value.` });
  if ((value.unit ?? '') !== (policy.expectedUnit ?? '')) issues.push({ code: 'UNIT_MISMATCH', message: `Expected unit: ${policy.expectedUnit ?? 'no unit'}. Unit conversion is not supported.` });
  const numeric = value.kind === 'numeric' ? exactDecimal(value.value) : null;
  if (value.kind === 'numeric' && !numeric) issues.push({ code: 'NUMERIC_FORMAT', message: 'Use a plain decimal with at most 20 integer and 18 fractional digits; no exponent or separators.' });
  if (value.kind === 'coded' && policy.allowedValues && !policy.allowedValues.includes(value.value)) issues.push({ code: 'CODE_NOT_ALLOWED', message: `Choose one of: ${policy.allowedValues.join(', ')}.` });
  if (issues.length) return { outcome: 'failed', issues, flag: 'not_evaluated', critical: 'not_evaluated', evaluatedAt };
  let flag: ResultValidation['flag'] = 'not_applicable';
  let critical: ResultValidation['critical'] = 'none';
  if (numeric) {
    flag = policy.lower !== undefined || policy.upper !== undefined ? 'normal' : 'not_applicable';
    if (policy.lower !== undefined && numeric.lessThan(new Prisma.Decimal(policy.lower))) flag = 'low';
    if (policy.upper !== undefined && numeric.greaterThan(new Prisma.Decimal(policy.upper))) flag = 'high';
    if (policy.criticalLower !== undefined && numeric.lessThanOrEqualTo(new Prisma.Decimal(policy.criticalLower))) critical = 'low';
    if (policy.criticalUpper !== undefined && numeric.greaterThanOrEqualTo(new Prisma.Decimal(policy.criticalUpper))) critical = 'high';
  } else if (policy.expectedValue !== undefined) flag = value.value === policy.expectedValue ? 'normal' : 'abnormal';
  return { outcome: 'passed', issues: [], flag, critical, evaluatedAt };
}

// Deliberately synthetic fixture thresholds. These are not patient reference
// intervals, clinical recommendations or validated critical-value policies.
export function syntheticPolicy(kind: ResultValue['kind'], unit?: string): ResultPolicy {
  return {
    version: 'synthetic-demo-v1', label: 'Synthetic demonstration policy — not clinically validated', synthetic: true,
    valueKind: kind, ...(unit ? { expectedUnit: unit } : {}),
    ...(kind === 'numeric' ? { lower: '10', upper: '20', criticalLower: '2', criticalUpper: '40' } : {}),
    ...(kind === 'coded' ? { allowedValues: ['DEMO_NEGATIVE', 'DEMO_POSITIVE'], expectedValue: 'DEMO_NEGATIVE' } : {}),
  };
}
