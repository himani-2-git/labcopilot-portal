import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AnalyticalResult, AnalyticalWorkItem, AuthSession, ResultHistory } from '@labcopilot/contracts';
import { AnalyticalWorklistPage, ResultDetailPage } from './ResultsPages';
import { api } from '../../lib/api';
import { patientStore } from '../../data/patients';

vi.mock('../../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/api')>(), api: { resultWorklist: vi.fn(), result: vi.fn(), resultHistory: vi.fn(), submitResult: vi.fn() } }));
vi.mock('../../data/patients', () => ({ patientStore: { cachedAnalyticalWorklist: vi.fn(), workflowOutbox: vi.fn(), cacheAnalyticalWorklist: vi.fn(), cachedResult: vi.fn(), cacheResult: vi.fn(), queueWorkflow: vi.fn() } }));

const session: AuthSession = {
  user: { id: 'technician', username: 'technician', displayName: 'Demo Technician', role: 'technician', facilityId: 'facility', facilityName: 'Demo Hospital', permissions: ['result:read', 'result:write'] },
  csrfToken: 'test-token', expiresAt: '2099-01-01T00:00:00.000Z', authMode: 'development',
};
const date = '2026-09-24T10:00:00.000Z';
const result: AnalyticalResult = {
  id: 'result-one', facilityId: 'facility', patientId: 'patient-one', patientName: 'Demo Patient 001', orderId: 'order-one', orderItemId: 'item-one',
  testId: 'test-one', testCode: 'DEMO-A', testName: 'Synthetic Test A', specimenId: 'specimen-one', accessionId: 'accession-one', accessionIdentifier: 'ACC-DEMO-A',
  version: 3, status: 'validated', value: { kind: 'numeric', value: '60.125', unit: 'demo-unit' },
  policy: { version: 'synthetic-rule-1', label: 'Synthetic rule', synthetic: true, valueKind: 'numeric', expectedUnit: 'demo-unit', lower: '10', upper: '20', criticalUpper: '50' },
  validation: { outcome: 'passed', issues: [], flag: 'high', critical: 'high' }, qc: { status: 'missing' }, readiness: 'pending', criticalReviewRequired: true,
  enteredBy: 'Demo Technician', enteredAt: date, createdAt: date, updatedAt: date,
};
const item = (id: string, state?: Partial<AnalyticalResult>): AnalyticalWorkItem => ({
  specimenId: 'specimen-one', specimenBarcode: 'SPM-DEMO-A', accessionId: `accession-${id}`, accessionIdentifier: `ACC-${id}`,
  patientId: `patient-${id}`, patientName: `Demo Patient ${id}`, orderId: `order-${id}`, orderItemId: `item-${id}`, testId: `test-${id}`, testCode: `DEMO-${id}`, testName: `Synthetic ${id}`, policy: result.policy,
  ...(state ? { result: { ...result, ...state, id: `result-${id}` } } : {}),
});
const rows = [item('waiting'), item('draft', { status: 'draft' }), item('entered', { status: 'entered' }), item('qc', {}), item('ready', { status: 'analytically_ready', readiness: 'ready', qc: { status: 'pass' } })];
const onError = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(patientStore.cachedAnalyticalWorklist).mockResolvedValue({ items: rows, updatedAt: date });
  vi.mocked(patientStore.workflowOutbox).mockResolvedValue([]);
  vi.mocked(api.resultWorklist).mockResolvedValue(rows);
  vi.mocked(patientStore.cachedResult).mockResolvedValue(result);
  vi.mocked(api.result).mockResolvedValue(result);
  const history: ResultHistory = { revisions: [{ id: 'revision-one', resultId: result.id, version: 3, previousVersion: 2, action: 'result.validate', actorId: session.user.id, actorName: session.user.displayName, createdAt: date, snapshot: result }], audit: [{ id: 'audit-one', actorId: session.user.id, actorName: session.user.displayName, action: 'result.critical.high', entityId: result.id, version: 3, correlationId: 'correlation-evidence', occurredAt: date }] };
  vi.mocked(api.resultHistory).mockResolvedValue(history);
});

describe('result workspace navigation and evidence', () => {
  it.each([
    ['unentered', ['waiting', 'draft']],
    ['entered', ['entered']],
    ['qc_pending', ['qc']],
  ])('honors the dashboard %s drill-down without showing unrelated work', async (filter, expected) => {
    render(<MemoryRouter initialEntries={[`/results?filter=${filter}&specimen=specimen-one`]}><AnalyticalWorklistPage session={session} online onError={onError} /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('Loading results…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Result filter')).toHaveValue(filter);
    for (const row of rows) expect(Boolean(screen.queryByText(row.patientName))).toBe(expected.includes(row.patientName.replace('Demo Patient ', '')));
  });

  it('keeps clinical context and critical state visible while technical evidence is optional', async () => {
    const approver = { ...session, user: { ...session.user, permissions: ['result:read' as const] } };
    render(<MemoryRouter initialEntries={['/results/result-one']}><Routes><Route path="/results/:id" element={<ResultDetailPage session={approver} online onError={onError} />} /></Routes></MemoryRouter>);
    await screen.findByText('Critical high result');
    expect(screen.getByRole('link', { name: 'Demo Patient 001' })).toHaveAttribute('href', '/patients/patient-one');
    expect(screen.getByRole('link', { name: 'Order' })).toHaveAttribute('href', '/orders/order-one');
    expect(screen.getByRole('link', { name: 'Specimen · ACC-DEMO-A' })).toHaveAttribute('href', '/specimens/specimen-one');
    expect(screen.getByText('Validation passed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Validate result' })).not.toBeInTheDocument();
    expect(screen.getByText('correlation-evidence')).not.toBeVisible();
    await userEvent.click(screen.getByText('Audit evidence'));
    expect(screen.getByText('correlation-evidence')).toBeVisible();
  });

  it('retains the exact correction value and existing versioned draft operation behind the correction section', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter initialEntries={['/results/result-one']}><Routes><Route path="/results/:id" element={<ResultDetailPage session={session} online onError={onError} />} /><Route path="/sync" element={<p>Drafts awaiting submission</p>} /></Routes></MemoryRouter>);
    await screen.findByText('Critical high result');
    expect(screen.getByLabelText('Correction reason')).not.toBeVisible();
    await userEvent.click(screen.getByText('Correct result'));
    const value = screen.getByLabelText('Result value (numeric)');
    await userEvent.clear(value); await userEvent.type(value, '15.0000000001');
    await userEvent.type(screen.getByLabelText('Correction reason'), 'Synthetic transcription correction');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction on device' }));
    await screen.findByText('Drafts awaiting submission');
    expect(patientStore.queueWorkflow).toHaveBeenCalledWith(expect.objectContaining({ kind: 'result.revise', entityId: result.id, expectedVersion: 3, payload: { value: { kind: 'numeric', value: '15.0000000001', unit: 'demo-unit' }, reason: 'Synthetic transcription correction' } }));
    expect(api.submitResult).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockRestore();
  });
});
