import type {
  AuditRecord,
  AnalyticalResult,
  AnalyticalWorkItem,
  AuthSession,
  CommandResult,
  Patient,
  PatientCommand,
  PatientRevision,
  ResultCommand,
  ResultHistory,
  LaboratoryOrder,
  LaboratoryPanel,
  LaboratoryTest,
  OrderCommand,
  Specimen,
  SpecimenCommand,
  WorkflowCommandResult,
} from '@labcopilot/contracts';

/** No credential or session token is written to browser storage. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'The server could not be reached. Your saved drafts remain on this device.', 'NETWORK_UNAVAILABLE');
  }
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const message = typeof error.message === 'string' ? error.message
      : Array.isArray(error.message) ? error.message.join('; ')
        : `The server rejected this request (${response.status}).`;
    throw new ApiError(response.status, message, typeof error.code === 'string' ? error.code : undefined, body);
  }
  return body as T;
}

const scopeHeaders = (session: AuthSession) => ({ 'x-workspace-user-id': session.user.id, 'x-workspace-facility-id': session.user.facilityId });
const csrfHeaders = (session: AuthSession) => ({ ...scopeHeaders(session), 'x-csrf-token': session.csrfToken });

export const api = {
  login: (username: string, password: string) => request<AuthSession>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  session: () => request<AuthSession>('/auth/session'),
  logout: (session: AuthSession) => request<void>('/auth/logout', {
    method: 'POST', headers: csrfHeaders(session),
  }),
  patients: (session: AuthSession) => request<Patient[]>('/patients', { headers: scopeHeaders(session) }),
  patient: (id: string, session: AuthSession) => request<Patient>(`/patients/${encodeURIComponent(id)}`, { headers: scopeHeaders(session) }),
  patientHistory: (id: string, session: AuthSession) => request<{ revisions: PatientRevision[]; audit: AuditRecord[] }>(
    `/patients/${encodeURIComponent(id)}/history`, { headers: scopeHeaders(session) },
  ),
  submitPatient: (command: PatientCommand, session: AuthSession) => request<CommandResult>('/patients/commands', {
    method: 'POST', headers: csrfHeaders(session), body: JSON.stringify(command),
  }),
  adminConfig: (session: AuthSession) => request<Record<string, unknown>>('/admin/config', { headers: scopeHeaders(session) }),
  reviewQueue: (session: AuthSession) => request<Record<string, unknown>>('/review/queue', { headers: scopeHeaders(session) }),
  catalogTests: (session: AuthSession) => request<LaboratoryTest[]>('/catalog/tests', { headers: scopeHeaders(session) }),
  catalogPanels: (session: AuthSession) => request<LaboratoryPanel[]>('/catalog/panels', { headers: scopeHeaders(session) }),
  orders: (session: AuthSession) => request<LaboratoryOrder[]>('/orders', { headers: scopeHeaders(session) }),
  order: (id: string, session: AuthSession) => request<LaboratoryOrder>(`/orders/${encodeURIComponent(id)}`, { headers: scopeHeaders(session) }),
  orderHistory: (id: string, session: AuthSession) => request<{ events: unknown[]; audit: AuditRecord[] }>(`/orders/${encodeURIComponent(id)}/history`, { headers: scopeHeaders(session) }),
  submitOrder: (command: OrderCommand, session: AuthSession) => request<WorkflowCommandResult>('/orders/commands', { method: 'POST', headers: csrfHeaders(session), body: JSON.stringify(command) }),
  specimens: (session: AuthSession) => request<Specimen[]>('/specimens', { headers: scopeHeaders(session) }),
  specimen: (id: string, session: AuthSession) => request<Specimen>(`/specimens/${encodeURIComponent(id)}`, { headers: scopeHeaders(session) }),
  specimenHistory: (id: string, session: AuthSession) => request<{ events: Array<{ id: string; fromStatus?: string; toStatus: string; action: string; actorName: string; reason?: string; occurredAt: string; correlationId: string }>; audit: AuditRecord[] }>(`/specimens/${encodeURIComponent(id)}/history`, { headers: scopeHeaders(session) }),
  submitSpecimen: (command: SpecimenCommand, session: AuthSession) => request<WorkflowCommandResult>('/specimens/commands', { method: 'POST', headers: csrfHeaders(session), body: JSON.stringify(command) }),
  accession: (identifier: string, session: AuthSession) => request<Specimen>(`/accessions/${encodeURIComponent(identifier)}`, { headers: scopeHeaders(session) }),
  resultWorklist: (session: AuthSession) => request<AnalyticalWorkItem[]>('/results/worklist', { headers: scopeHeaders(session) }),
  results: (session: AuthSession) => request<AnalyticalResult[]>('/results', { headers: scopeHeaders(session) }),
  result: (id: string, session: AuthSession) => request<AnalyticalResult>(`/results/${encodeURIComponent(id)}`, { headers: scopeHeaders(session) }),
  resultHistory: (id: string, session: AuthSession) => request<ResultHistory>(`/results/${encodeURIComponent(id)}/history`, { headers: scopeHeaders(session) }),
  submitResult: (command: ResultCommand, session: AuthSession) => request<WorkflowCommandResult>('/results/commands', { method: 'POST', headers: csrfHeaders(session), body: JSON.stringify(command) }),
};

