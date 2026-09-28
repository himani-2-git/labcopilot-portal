import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, PatientCommand } from '@labcopilot/contracts';
import { api, ApiError } from '../lib/api';

const session: AuthSession = {
  user: {
    id: '22222222-2222-4222-8222-222222222222', username: 'demo.clerk', displayName: 'Demo Clerk',
    facilityId: '11111111-1111-4111-8111-111111111111', facilityName: 'Demo Hospital',
    role: 'registration_clerk', permissions: ['patient:read', 'patient:write'],
  },
  csrfToken: 'synthetic-csrf-fixture', expiresAt: '2099-01-01T00:00:00.000Z', authMode: 'development',
};
const command: PatientCommand = {
  protocolVersion: 1, operationId: '33333333-3333-4333-8333-333333333333',
  entityId: '44444444-4444-4444-8444-444444444444', kind: 'patient.create', expectedVersion: 0,
  payload: { displayName: 'Demo Transport Test', dateOfBirth: '1991-01-15', sex: 'unknown', preferredLanguage: 'en', synthetic: true },
};
afterEach(() => vi.unstubAllGlobals());

describe('authenticated patient API transport', () => {
  it('sends cookies, CSRF and workspace identity with the unchanged command and disables request caching', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operationId: command.operationId }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await api.submitPatient(command, session);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/patients/commands', {
      method: 'POST', body: JSON.stringify(command), credentials: 'same-origin', cache: 'no-store',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        'x-workspace-user-id': session.user.id, 'x-workspace-facility-id': session.user.facilityId,
        'x-csrf-token': session.csrfToken,
      },
    });
  });

  it('includes workspace identity on patient reads and preserves authorization failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Workspace changed', code: 'WORKSPACE_MISMATCH' }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api.patients(session)).rejects.toMatchObject({ status: 403, code: 'WORKSPACE_MISMATCH', message: 'Workspace changed' });
    expect(fetcher.mock.calls[0]![1].headers).toMatchObject({
      'x-workspace-user-id': session.user.id, 'x-workspace-facility-id': session.user.facilityId,
    });
  });

  it('classifies interrupted transport as retryable without changing the saved command', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const original = structuredClone(command);
    await expect(api.submitPatient(command, session)).rejects.toBeInstanceOf(ApiError);
    await expect(api.submitPatient(command, session)).rejects.toMatchObject({ status: 0, code: 'NETWORK_UNAVAILABLE' });
    expect(command).toEqual(original);
  });
});
