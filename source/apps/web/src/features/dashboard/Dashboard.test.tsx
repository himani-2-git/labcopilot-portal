import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS, type AnalyticalResult, type AnalyticalWorkItem, type AuthSession, type Role, type Specimen } from '@labcopilot/contracts';
import { Dashboard, attentionCounts } from './Dashboard';
import { api, ApiError } from '../../lib/api';
import { errorMessage } from '../../components/ui';

const session = (role: Role): AuthSession => ({
  user: { id: 'user', username: 'demo', displayName: 'Demo user', role, facilityId: 'facility', facilityName: 'Demo Hospital', permissions: ROLE_PERMISSIONS[role] },
  csrfToken: 'test-only', expiresAt: '2099-01-01T00:00:00.000Z', authMode: 'development',
});
const item = (overrides?: Partial<AnalyticalResult>): AnalyticalWorkItem => ({
  specimenId: 'specimen', specimenBarcode: 'barcode', accessionId: 'accession', accessionIdentifier: 'ACC-demo',
  patientId: 'patient', patientName: 'Demo Patient 001', orderId: 'order', orderItemId: 'item', testId: 'test', testCode: 'DEMO', testName: 'Demo test',
  policy: { version: '1', label: 'Synthetic', synthetic: true, valueKind: 'numeric' },
  ...(overrides ? { result: { id: 'result', facilityId: 'facility', patientId: 'patient', patientName: 'Demo Patient 001', orderId: 'order', orderItemId: 'item', testId: 'test', testCode: 'DEMO', testName: 'Demo test', specimenId: 'specimen', accessionId: 'accession', accessionIdentifier: 'ACC-demo', version: 1, status: 'draft', value: { kind: 'numeric', value: '1' }, policy: { version: '1', label: 'Synthetic', synthetic: true, valueKind: 'numeric' }, validation: { outcome: 'not_run', issues: [], flag: 'not_evaluated', critical: 'not_evaluated' }, qc: { status: 'missing' }, readiness: 'pending', criticalReviewRequired: false, createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', ...overrides } } : {}),
});
function show(role: Role = 'technician', online = true) {
  return render(<MemoryRouter><Dashboard session={session(role)} online={online} outbox={[]} workflowOutbox={[]} onError={vi.fn()} /></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('operational dashboard', () => {
  it('counts draft and unstarted tests together, keeps critical ready results visible, and excludes ready results from QC queue', () => {
    const validation = { outcome: 'passed' as const, issues: [], flag: 'high' as const, critical: 'high' as const };
    const work = [item(), item({ status: 'draft' }), item({ status: 'entered' }), item({ status: 'validated', readiness: 'blocked' }), item({ status: 'analytically_ready', validation, qc: { status: 'pass' }, readiness: 'ready' })];
    expect(attentionCounts([], work)).toMatchObject({ entry: 2, validation: 1, qc: 1, blocked: 1, abnormal: 1, critical: 1 });
  });
  it('distinguishes pending collection, accession and decisions', () => {
    const specimens = ['ordered', 'collection_pending', 'recollection_required', 'collected', 'received_accession_pending', 'accepted', 'rejected'].map(status => ({ status }) as Specimen);
    expect(attentionCounts(specimens, [])).toMatchObject({ collection: 3, accession: 1, decision: 1 });
  });
  it('does not fetch analytical records for a clerk', async () => {
    const specimens = vi.spyOn(api, 'specimens').mockResolvedValue([]);
    const results = vi.spyOn(api, 'resultWorklist').mockResolvedValue([]);
    show('registration_clerk');
    await waitFor(() => expect(specimens).toHaveBeenCalledOnce());
    expect(results).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Results needing attention' })).not.toBeInTheDocument();
  });
  it('does not fetch laboratory records for an administrator', () => {
    const specimens = vi.spyOn(api, 'specimens').mockResolvedValue([]);
    const results = vi.spyOn(api, 'resultWorklist').mockResolvedValue([]);
    show('administrator');
    expect(specimens).not.toHaveBeenCalled(); expect(results).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open configuration' })).toBeVisible();
  });
  it('shows unknown counts on a failed request instead of inventing zero', async () => {
    vi.spyOn(api, 'specimens').mockRejectedValue(new ApiError(0, 'Connection interrupted.'));
    vi.spyOn(api, 'resultWorklist').mockResolvedValue([]);
    show();
    await screen.findByText(/Connection interrupted/);
    expect(screen.getByRole('link', { name: /Awaiting collection/ }).querySelector('strong')).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /Awaiting result entry/ }).querySelector('strong')).toHaveTextContent('0');
  });
  it('uses actionable filters and refreshes queues on request', async () => {
    vi.spyOn(api, 'specimens').mockResolvedValue([]);
    const results = vi.spyOn(api, 'resultWorklist').mockResolvedValue([item()]);
    show();
    await waitFor(() => expect(screen.getByRole('link', { name: /Awaiting result entry/ })).toHaveTextContent('1'));
    expect(screen.getByRole('link', { name: /Awaiting result entry/ })).toHaveAttribute('href', '/results?filter=unentered');
    expect(screen.getByRole('link', { name: /QC \/ Readiness/ })).toHaveAttribute('href', '/results?filter=qc_pending');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh queues' }));
    await waitFor(() => expect(results).toHaveBeenCalledTimes(2));
  });
  it('does not invent current server counts while offline', () => {
    const specimens = vi.spyOn(api, 'specimens').mockResolvedValue([]);
    const results = vi.spyOn(api, 'resultWorklist').mockResolvedValue([]);
    show('technician', false);
    expect(specimens).not.toHaveBeenCalled(); expect(results).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Counts are unavailable offline/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Awaiting result entry/ }).querySelector('strong')).toHaveTextContent('—');
  });
});
describe('workflow error presentation', () => {
  it('explains version conflicts without altering the error evidence', () => {
    const error = new ApiError(409, 'expectedVersion mismatch', 'VERSION_CONFLICT');
    expect(errorMessage(error)).toContain('this record was updated elsewhere');
    expect(error.message).toBe('expectedVersion mismatch');
  });
  it('preserves specific validation and transition errors', () => {
    expect(errorMessage(new ApiError(409, 'Only collected specimens can be received.'))).toBe('Only collected specimens can be received.');
  });
});
