import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, LaboratoryOrder, Specimen } from '@labcopilot/contracts';
import { api } from '../../lib/api';
import { AccessionLookupPage, OrderDetailPage, OrdersPage, SpecimenDetailPage, SpecimenQueuePage } from './LaboratoryPages';

const session: AuthSession = {
  user: { id: 'user', username: 'clerk', displayName: 'Demo Clerk', role: 'registration_clerk', facilityId: 'facility', facilityName: 'Demo Hospital', permissions: ['patient:read', 'order:read', 'specimen:read', 'specimen:write'] },
  csrfToken: 'fixture', expiresAt: '2099-01-01T00:00:00.000Z', authMode: 'development',
};
const specimen: Specimen = {
  id: 'specimen', patientId: 'patient', patientName: 'Demo Patient 001', facilityId: 'facility', orderId: 'order', attemptNumber: 1, version: 1,
  specimenType: 'whole_blood', status: 'collection_pending', barcodeValue: 'SPM-001', createdAt: '2026-09-24T01:00:00Z', updatedAt: '2026-09-24T01:00:00Z',
};
const order: LaboratoryOrder = {
  id: 'order', patientId: 'patient', patientName: 'Demo Patient 001', facilityId: 'facility', version: 1, status: 'ordered', priority: 'routine',
  orderedBy: 'Demo Clerk', orderedAt: specimen.createdAt, updatedAt: specimen.updatedAt,
  items: [{ id: 'item', itemType: 'test', test: { id: 'test', code: 'DEMO-TEST', name: 'Synthetic cell count', specimenType: 'whole_blood', status: 'active' } }],
  specimens: [],
};
afterEach(() => vi.restoreAllMocks());
function mockSpecimen() {
  vi.spyOn(api, 'specimen').mockResolvedValue(specimen);
  vi.spyOn(api, 'specimenHistory').mockResolvedValue({ events: [], audit: [] });
  vi.spyOn(api, 'order').mockResolvedValue(order);
}

describe('laboratory workflow context', () => {
  it('shows ordered tests and related records without requesting results for a clerk', async () => {
    mockSpecimen(); const results = vi.spyOn(api, 'results');
    render(<MemoryRouter initialEntries={['/specimens/specimen']}><Routes><Route path="/specimens/:id" element={<SpecimenDetailPage session={session} online />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Synthetic cell count')).toBeInTheDocument();
    expect(results).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open patient' })).toHaveAttribute('href', '/patients/patient');
    expect(screen.getByRole('link', { name: 'Order ORDER' })).toHaveAttribute('href', '/orders/order');
    expect(screen.getByRole('button', { name: 'Mark collected' })).toBeInTheDocument();
    expect(screen.getByText('Audit evidence').closest('details')).not.toHaveAttribute('open');
  });

  it('keeps specimen context visible when results fail and hides collection actions from a read-only approver', async () => {
    mockSpecimen(); vi.spyOn(api, 'results').mockRejectedValue(new Error('Unavailable'));
    const reader: AuthSession = { ...session, user: { ...session.user, role: 'qualified_approver', permissions: ['patient:read', 'order:read', 'specimen:read', 'result:read'] } };
    render(<MemoryRouter initialEntries={['/specimens/specimen']}><Routes><Route path="/specimens/:id" element={<SpecimenDetailPage session={reader} online />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Synthetic cell count')).toBeInTheDocument();
    expect(screen.getByText('Results could not be loaded. Open Results to try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark collected' })).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting entry')).not.toBeInTheDocument();
  });

  it('honors a dashboard link containing multiple specimen statuses', async () => {
    vi.spyOn(api, 'specimens').mockResolvedValue([specimen, { ...specimen, id: 'other', patientName: 'Demo Patient 002', status: 'accepted' }]);
    render(<MemoryRouter initialEntries={['/specimens?status=collection_pending,collected']}><SpecimenQueuePage session={session} online /></MemoryRouter>);
    expect(await screen.findByText('Demo Patient 001')).toBeInTheDocument();
    expect(screen.queryByText('Demo Patient 002')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Specimen status')).toHaveValue('collection_pending,collected');
  });

  it('honors patient-specific order links without showing other patients', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([order, { ...order, id: 'other-order', patientId: 'other-patient', patientName: 'Demo Patient 002' }]);
    render(<MemoryRouter initialEntries={['/orders?patient=patient']}><OrdersPage session={session} online /></MemoryRouter>);
    expect(await screen.findByText('Demo Patient 001')).toBeInTheDocument();
    expect(screen.queryByText('Demo Patient 002')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open patient' })).toHaveAttribute('href', '/patients/patient');
  });

  it('identifies the latest collection attempt even when the API returns attempts newest first', async () => {
    const prior: LaboratoryOrder['specimens'][number] = { id: 'prior', attemptNumber: 1, status: 'recollection_required', barcodeValue: 'SPM-PRIOR', accessionIdentifier: 'ACC-PRIOR', createdAt: specimen.createdAt };
    const latest: LaboratoryOrder['specimens'][number] = { id: 'latest', attemptNumber: 2, status: 'collection_pending', barcodeValue: 'SPM-LATEST', createdAt: specimen.updatedAt };
    vi.spyOn(api, 'order').mockResolvedValue({ ...order, specimen: latest, specimens: [latest, prior] });
    vi.spyOn(api, 'orderHistory').mockResolvedValue({ events: [], audit: [] });
    render(<MemoryRouter initialEntries={['/orders/order']}><Routes><Route path="/orders/:id" element={<OrderDetailPage session={session} online />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Open latest specimen' })).toHaveAttribute('href', '/specimens/latest');
    expect(screen.queryByRole('button', { name: 'Generate replacement specimen' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View attempt' }).map(link => link.getAttribute('href'))).toEqual(['/specimens/prior', '/specimens/latest']);
  });

  it('generates a new specimen only after a recollection request and a confirmation', async () => {
    const prior: LaboratoryOrder['specimens'][number] = { id: 'prior', attemptNumber: 1, status: 'recollection_required', barcodeValue: 'SPM-PRIOR', accessionIdentifier: 'ACC-PRIOR', createdAt: specimen.createdAt };
    vi.spyOn(api, 'order').mockResolvedValue({ ...order, specimen: prior, specimens: [prior] });
    vi.spyOn(api, 'orderHistory').mockResolvedValue({ events: [], audit: [] });
    const submit = vi.spyOn(api, 'submitSpecimen').mockResolvedValue({ operationId: 'operation', replayed: false, specimen: { ...specimen, id: 'replacement', attemptNumber: 2, barcodeValue: 'SPM-REPLACEMENT' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter initialEntries={['/orders/order']}><Routes><Route path="/orders/:id" element={<OrderDetailPage session={session} online />} /></Routes></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Generate replacement specimen' }));
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ kind: 'specimen.create', expectedVersion: 0, payload: { orderId: 'order' } });
    expect(submit.mock.calls[0]?.[0].entityId).not.toBe('prior');
  });

  it('keeps a recollected specimen read-only and directs collection to a new attempt', async () => {
    vi.spyOn(api, 'specimen').mockResolvedValue({ ...specimen, status: 'recollection_required', accession: {
      id: 'accession', identifier: 'ACC-PRIOR', barcodeValue: 'ACC-PRIOR', specimenId: 'specimen', orderId: 'order', patientId: 'patient', decision: 'rejected',
    } });
    vi.spyOn(api, 'specimenHistory').mockResolvedValue({ events: [], audit: [] });
    vi.spyOn(api, 'order').mockResolvedValue(order);
    render(<MemoryRouter initialEntries={['/specimens/specimen']}><Routes><Route path="/specimens/:id" element={<SpecimenDetailPage session={session} online />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Open order for replacement' })).toHaveAttribute('href', '/orders/order');
    expect(screen.queryByRole('button', { name: 'Mark collected' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive & generate accession' })).not.toBeInTheDocument();
    expect(screen.getByText('ACC-PRIOR')).toBeInTheDocument();
  });

  it('shows the exact historical accession and decision returned by lookup', async () => {
    const match: Specimen = { ...specimen, id: 'prior', status: 'recollection_required', barcodeValue: 'SPM-PRIOR',
      accession: { id: 'accession', identifier: 'ACC-PRIOR', barcodeValue: 'ACC-PRIOR', specimenId: 'prior', orderId: 'order', patientId: 'patient', decision: 'rejected' },
      lookupMatchedAccessionId: 'accession', lookupIsHistorical: true };
    const lookup = vi.spyOn(api, 'accession').mockResolvedValue(match);
    render(<MemoryRouter><AccessionLookupPage session={session} online /></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Accession identifier' }), 'ACC-PRIOR');
    await user.click(screen.getByRole('button', { name: 'Lookup' }));
    expect(await screen.findByText('MATCHED ACCESSION')).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith('ACC-PRIOR', session);
    expect(screen.getByText('ACC-PRIOR', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open specimen' })).toHaveAttribute('href', '/specimens/prior');
    expect(screen.getByRole('link', { name: 'See all collection attempts' })).toHaveAttribute('href', '/orders/order');
    expect(screen.getByText(/prior accession for this order/i)).toBeInTheDocument();
  });
});
