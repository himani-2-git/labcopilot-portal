import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCheck, Clock3, CloudUpload, FileClock, HardDrive, History, Pencil, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { type AuthSession, type LaboratoryOrder, type PatientHistory } from '@labcopilot/contracts';
import { EmptyState, ErrorNotice, Loading, StatusBadge, errorMessage, formatDate } from '../../components/ui';
import type { LocalPatient, QueuedPatientCommand, QueuedWorkflowCommand } from '../../data/patients';
import { api } from '../../lib/api';
import { PatientForm } from './PatientForm';

const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const languageLabel = (code: string) => code === 'hi' ? 'Hindi' : 'English';
const dateOfBirthLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function PatientTable({ patients }: { patients: LocalPatient[] }) {
  return <div className="table-scroll"><table className="patients-table"><thead><tr><th scope="col">Patient</th><th scope="col">Date of birth</th><th scope="col">Sync status</th><th scope="col">Last updated · IST</th><th scope="col"><span className="sr-only">Open patient</span></th></tr></thead><tbody>{patients.map(patient => <tr key={patient.id}><td><Link className="patient-cell" to={`/patients/${patient.id}`}><span className="patient-avatar">{patient.demographics.displayName.replace(/^Demo\s+/, '').slice(0, 2).toUpperCase()}</span><span><strong>{patient.demographics.displayName}</strong><small>DEMO · {shortId(patient.id)}</small></span></Link></td><td>{dateOfBirthLabel(patient.demographics.dateOfBirth)}</td><td><StatusBadge status={patient.syncStatus} /></td><td className="subtle-text">{formatDate(patient.updatedAt)}</td><td><Link className="table-open" aria-label={`Open ${patient.demographics.displayName}`} to={`/patients/${patient.id}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>;
}

function Metric({ label, value, detail, icon, attention }: { label: string; value: number; detail: string; icon: React.ReactNode; attention?: boolean }) { return <section className={`metric-card ${attention ? 'metric-attention' : ''}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value.toString().padStart(2, '0')}</strong><small>{detail}</small></section>; }

export function PatientList({ patients, busy, canWrite, onRefresh }: { patients: LocalPatient[]; busy: boolean; canWrite: boolean; onRefresh: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => patients.filter(p => (filter === 'all' || (filter === 'attention' ? ['conflict', 'rejected'].includes(p.syncStatus) : p.syncStatus === filter)) && `${p.demographics.displayName} ${p.id}`.toLowerCase().includes(query.toLowerCase())), [patients, filter, query]);
  return <><div className="page-heading"><div><div className="eyebrow">PATIENT REGISTRY</div><h1>Patients</h1><p>Find a patient, check their details and follow their laboratory orders.</p></div>{canWrite && <Link className="button button-primary" to="/patients/new"><Plus size={17} />Create patient</Link>}</div>{!canWrite && <div className="notice info-notice"><ShieldCheck size={18} />You can view patients in this facility. Registration staff can update their details.</div>}<section className="card"><div className="list-toolbar"><div className="search-field"><Search size={17} /><label className="sr-only" htmlFor="patient-search">Search patients</label><input id="patient-search" type="search" placeholder="Search name or patient ID" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="toolbar-actions"><label className="sr-only" htmlFor="storage-filter">Sync status filter</label><select id="storage-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All sync statuses</option><option value="synced">Up to date</option><option value="pending">Saved on device</option><option value="attention">Needs attention</option></select><button className="button button-secondary" onClick={onRefresh} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} />Refresh</button></div></div>{busy && !patients.length ? <Loading /> : filtered.length ? <PatientTable patients={filtered} /> : <EmptyState title={query || filter !== 'all' ? 'No matching patients' : 'No patient records yet'} action={canWrite && !query && filter === 'all' ? <Link className="button button-primary" to="/patients/new"><Plus size={16} />Create patient</Link> : undefined}>{query || filter !== 'all' ? 'Try another name, patient ID or sync status.' : 'Register a patient, or refresh to retrieve your facility’s records.'}</EmptyState>}<div className="table-footer"><span>{filtered.length} of {patients.length} records</span><span>Your facility · Synthetic data</span></div></section></>;
}

export function PatientEditor({ patients, online, busy = false, onSave }: { patients: LocalPatient[]; online: boolean; busy?: boolean; onSave: (demographics: LocalPatient['demographics'], submit: boolean, id?: string) => Promise<string> }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const patient = patients.find(p => p.id === id);
  if (id && !patient) return busy ? <Loading /> : <EmptyState title="Patient is not available">Return to Patients and refresh online to retrieve this record.</EmptyState>;
  if (patient?.syncStatus === 'conflict' || patient?.syncStatus === 'rejected') return <EmptyState title="This saved change needs attention" action={<Link className="button button-secondary" to={`/patients/${id}`}>View preserved draft</Link>}>Further edits are paused while a previous change needs attention. Your saved draft is retained.</EmptyState>;
  return <><Link className="back-link" to={id ? `/patients/${id}` : '/patients'}><ArrowLeft size={16} />{id ? 'Back to patient' : 'Back to patients'}</Link><div className="page-heading"><div><div className="eyebrow">{id ? `PATIENT ${shortId(id)}` : 'PATIENT REGISTRATION'}</div><h1>{id ? 'Edit patient draft' : 'Create patient'}</h1><p>{id ? 'Update the patient’s demographics. Changes are saved on this device first.' : 'Create an invented patient to begin the laboratory workflow.'}</p></div><span className="tag">{online ? 'Connected' : 'Offline entry'}</span></div><div className="editor-layout"><section className="card"><PatientForm key={id ?? 'new'} initial={patient?.demographics} online={online} onCancel={() => navigate(id ? `/patients/${id}` : '/patients')} onSave={async (data, submit) => { const savedId = await onSave(data, submit, id); navigate(`/patients/${savedId}`); }} /></section><aside className="entry-guidance"><div className="guidance-icon"><HardDrive size={23} /></div><h2>Saved here first.</h2><p>Save the patient details on this device, then submit them when connected.</p><ul><li>Your saved changes remain available after an interrupted connection.</li><li>Updates made elsewhere are flagged for attention.</li><li>Submitted changes appear in the patient history.</li></ul><div className="small-boundary"><strong>Device storage has limits</strong><p>Unsynced drafts can be lost if browser data is cleared or evicted. Submit pending changes when connected.</p></div></aside></div></>;
}

export function PatientDetail({ patients, session, online, busy, canWrite, onError }: { patients: LocalPatient[]; session: AuthSession; online: boolean; busy: boolean; canWrite: boolean; onError: (error: unknown) => void }) {
  const { id } = useParams();
  const patient = patients.find(p => p.id === id);
  const [history, setHistory] = useState<PatientHistory>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<LaboratoryOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [ordersLimited, setOrdersLimited] = useState(false);
  const canReadOrders = session.user.permissions.includes('order:read');
  const canCreateOrder = session.user.permissions.includes('order:write') && patient?.syncStatus === 'synced' && Boolean(patient.serverVersion);
  useEffect(() => {
    let active = true;
    setHistory(undefined); setError(''); setLoading(false);
    if (!id || !online || !patient?.serverVersion) return;
    setLoading(true);
    void api.patientHistory(id, session).then(result => { if (active) setHistory(result); }).catch(err => { if (active) { setError(errorMessage(err)); onError(err); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, patient?.serverVersion, session, online, onError]);
  useEffect(() => {
    let active = true;
    setOrders([]); setOrdersError(''); setOrdersLimited(false); setOrdersLoading(false);
    if (!id || !online || !patient?.serverVersion || !canReadOrders) return;
    setOrdersLoading(true);
    void api.orders(session).then(records => {
      if (active) { setOrders(records.filter(order => order.patientId === id)); setOrdersLimited(records.length >= 500); }
    }).catch(err => { if (active) { setOrdersError(errorMessage(err)); onError(err); } }).finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [id, patient?.serverVersion, session, online, canReadOrders, onError]);
  if (!patient) return busy ? <Loading /> : <EmptyState title="Patient is not available" action={<Link className="button button-secondary" to="/patients">Back to patients</Link>}>Refresh Patients when connected to retrieve this record.</EmptyState>;
  return <>
    <Link className="back-link" to="/patients"><ArrowLeft size={16} />Back to patients</Link>
    <div className="page-heading"><div><div className="eyebrow">PATIENT RECORD · {shortId(patient.id)}</div><h1>{patient.demographics.displayName}</h1><p>{session.user.facilityName} · Synthetic patient</p></div><div className="button-group">{canWrite && !['conflict', 'rejected'].includes(patient.syncStatus) && <Link to={`/patients/${patient.id}/edit`} className="button button-secondary"><Pencil size={16} />Edit draft</Link>}{canCreateOrder && <Link className="button button-primary" to={`/orders/new?patient=${patient.id}`}><Plus size={16} />Create order</Link>}</div></div>
    {patient.syncError && <ErrorNotice>{patient.syncStatus === 'conflict' ? 'Conflict — this record was updated elsewhere.' : 'This patient change needs attention before it can be submitted.'} Your saved draft is retained. Open Device & sync for details.</ErrorNotice>}
    <div className="detail-layout">
      <section className="card"><div className="card-heading"><div><h2>Patient demographics</h2><p>{patient.syncStatus === 'synced' ? 'Last submitted details' : 'Saved details on this device'}</p></div></div><dl className="detail-grid"><div><dt>Date of birth</dt><dd>{dateOfBirthLabel(patient.demographics.dateOfBirth)}</dd></div><div><dt>Sex</dt><dd className="capitalize">{patient.demographics.sex}</dd></div><div><dt>Preferred report language</dt><dd>{languageLabel(patient.demographics.preferredLanguage)}</dd></div><div><dt>Patient ID</dt><dd className="identifier">{shortId(patient.id)}</dd></div></dl></section>
      <section className="card record-status"><div className="card-heading"><div><h2>Record status</h2><p>Changes saved and submitted</p></div><CloudUpload size={20} /></div><div className="status-body"><StatusBadge status={patient.syncStatus} /><dl><div><dt>Updated · IST</dt><dd>{formatDate(patient.updatedAt)}</dd></div></dl><Link to="/sync" className="text-link">Open Device & sync <ArrowRight size={14} /></Link></div></section>
    </div>
    {canReadOrders && <section className="card">
      <div className="card-heading"><div><h2>Laboratory orders</h2><p>Requested tests and specimen progress for this patient.</p></div><Link className="text-link" to={`/orders?patient=${patient.id}`}>View patient orders <ArrowRight size={15} /></Link></div>
      {!online ? <EmptyState title="Connect to view orders">Patient details remain available on this device. Reconnect to load the latest orders.</EmptyState>
        : !patient.serverVersion ? <EmptyState title="Submit the patient first">Submit this patient from Device & sync before creating a laboratory order.</EmptyState>
        : ordersLoading ? <Loading label="Loading patient orders…" />
        : ordersError ? <ErrorNotice>{ordersError}</ErrorNotice>
        : orders.length ? <div className="table-scroll"><table><thead><tr><th>Order</th><th>Tests / panels</th><th>Status</th><th>Specimen</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link className="text-link" to={`/orders/${order.id}`}>{shortId(order.id)} <ArrowRight size={14} /></Link><small className="table-subtext">{formatDate(order.orderedAt)}</small></td><td>{order.items.map(item => item.test?.name ?? item.panel?.name).join(' · ')}</td><td><span className="tag">{order.status === 'ordered' ? 'Ordered' : 'Cancelled'}</span></td><td>{order.specimen ? <Link className="text-link" to={`/specimens/${order.specimen.id}`}>{order.specimen.status.replaceAll('_', ' ')} <ArrowRight size={14} /></Link> : 'Awaiting collection record'}</td></tr>)}</tbody></table></div>
        : <EmptyState title={ordersLimited ? 'No recent orders found for this patient' : 'No orders yet'}>{ordersLimited ? 'Only the latest 500 orders in your facility are available in this view.' : 'Create an order to begin specimen collection.'}</EmptyState>}
      {ordersLimited && orders.length > 0 && <p className="small-boundary">Showing matches within the latest 500 facility orders. Older orders may not be listed.</p>}
    </section>}
    <section className="card history-card">
      <div className="card-heading"><div><h2>Patient history</h2><p>Submitted changes. Pending edits are shown in Device & sync.</p></div><History size={21} /></div>
      {!online ? <EmptyState title="Connect to view history">Reconnect to retrieve the submitted patient history.</EmptyState>
        : !patient.serverVersion ? <EmptyState title="No submitted history yet">Submit this draft to add the first patient history entry.</EmptyState>
        : loading ? <Loading label="Loading patient history…" />
        : error ? <div className="history-error"><ErrorNotice>{error}</ErrorNotice></div>
        : history ? <ol className="revision-timeline">{history.revisions.map(revision => <li key={revision.version}><span className="timeline-marker"><CheckCheck size={15} /></span><div><div className="revision-heading"><strong>{revision.version === 1 ? 'Patient registered' : 'Demographics updated'}</strong><span>{formatDate(revision.createdAt)}</span></div><p>{revision.actorName}</p><div className="revision-snapshot"><span>{revision.demographics.displayName}</span><span>{dateOfBirthLabel(revision.demographics.dateOfBirth)}</span><span className="capitalize">{revision.demographics.sex}</span><span>{languageLabel(revision.demographics.preferredLanguage)}</span></div></div></li>)}</ol> : null}
    </section>
    <details className="card audit-evidence"><summary>Audit evidence</summary>
      <dl className="detail-grid"><div><dt>Patient ID</dt><dd className="identifier">{patient.id}</dd></div><div><dt>Local revision</dt><dd>{patient.version}</dd></div><div><dt>Server revision</dt><dd>{patient.serverVersion || 'Not submitted'}</dd></div></dl>
      {patient.syncError && <p>{patient.syncError}</p>}
      {history && <div className="table-scroll"><table><thead><tr><th scope="col">Action / actor</th><th scope="col">Revision</th><th scope="col">Timestamp · IST</th><th scope="col">Correlation ID</th></tr></thead><tbody>{history.audit.map(event => <tr key={event.id}><td><strong>{event.action}</strong><small className="table-subtext">{event.actorName}</small></td><td>{event.version}</td><td>{formatDate(event.occurredAt)}</td><td className="identifier">{event.correlationId}</td></tr>)}</tbody></table></div>}
      {!history && <p>Connect and submit the patient to retrieve audit evidence.</p>}
    </details>
  </>;
}

const syncAction = (kind: string) => ({
  'patient.create': 'Register patient', 'patient.update': 'Update patient details',
  'order.create': 'Create order', 'specimen.create': 'Generate specimen',
  'specimen.collect': 'Record collection', 'specimen.receive': 'Receive specimen',
  'specimen.accept': 'Accept specimen', 'specimen.reject': 'Reject specimen',
  'specimen.recollect': 'Request recollection', 'result.create': 'Save result draft',
  'result.revise': 'Correct result',
}[kind] ?? 'Update laboratory record');
function SyncEvidence({ row }: { row: QueuedPatientCommand | QueuedWorkflowCommand }) {
  return <details className="sync-details"><summary>Sync details</summary><dl>
    <div><dt>Action</dt><dd>{row.command.kind}</dd></div>
    <div><dt>Record ID</dt><dd className="identifier">{row.entityId}</dd></div>
    <div><dt>Operation ID</dt><dd className="identifier">{row.operationId}</dd></div>
    <div><dt>Expected version</dt><dd>{row.command.expectedVersion}</dd></div>
    <div><dt>Attempts</dt><dd>{row.attempts}</dd></div>
  </dl>{row.lastError && <p>{row.lastError}</p>}</details>;
}
function SyncIssue({ row }: { row: QueuedPatientCommand | QueuedWorkflowCommand }) {
  if (row.status === 'conflict') return <small className="queue-error">Conflict — this record was updated elsewhere. Your saved change is retained.</small>;
  if (row.status === 'rejected') return <small className="queue-error">This change needs attention. Review Sync details; your saved change is retained.</small>;
  if (row.lastError) return <small className="queue-error">Submission did not finish. Reconnect or sign in again, then select Submit pending.</small>;
  return null;
}
export function SyncPage({ outbox, workflowOutbox, patients, online, canWrite, submitting, onSubmit }: { outbox: QueuedPatientCommand[]; workflowOutbox: QueuedWorkflowCommand[]; patients: LocalPatient[]; online: boolean; canWrite: boolean; submitting: boolean; onSubmit: () => void }) {
  const pending = [...outbox, ...workflowOutbox].filter(row => row.status === 'pending').length;
  const blocked = outbox.length + workflowOutbox.length - pending;
  return <>
    <div className="page-heading"><div><div className="eyebrow">DEVICE WORKSPACE</div><h1>Device & sync</h1><p>Patient and laboratory changes saved on this device.</p></div>{canWrite && <button className="button button-primary" disabled={!online || submitting || !pending} onClick={onSubmit}><CloudUpload size={17} className={submitting ? 'spin' : ''} />{submitting ? 'Submitting…' : 'Submit pending'}</button>}</div>
    <div className="notice info-notice"><HardDrive size={19} /><div><strong>{online ? 'Ready to submit saved changes.' : 'You are offline.'}</strong> Reconnect and select Submit pending. Changes are not submitted automatically.</div></div>
    <div className="metrics-grid sync-metrics"><Metric label="Ready to submit" value={pending} detail="Saved changes awaiting submission" icon={<CloudUpload />} /><Metric label="Need attention" value={blocked} detail="Saved changes are retained" icon={<FileClock />} attention={blocked > 0} /><Metric label="Patients on this device" value={patients.length} detail="Available in your workspace" icon={<HardDrive />} /></div>
    {blocked > 0 && <ErrorNotice>Changes with a conflict or error are kept for review and are not retried automatically. Review their details before making further changes.</ErrorNotice>}
    <section className="card">
      <div className="card-heading"><div><h2>Pending patient changes</h2><p>Changes for each patient are submitted in the order they were saved.</p></div><Clock3 size={21} /></div>
      {outbox.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Patient</th><th scope="col">Change</th><th scope="col">Status</th><th scope="col">Saved · IST</th></tr></thead><tbody>{outbox.map(row => <tr key={row.operationId}><td><Link className="text-link" to={`/patients/${row.entityId}`}>{patients.find(p => p.id === row.entityId)?.demographics.displayName ?? shortId(row.entityId)}</Link></td><td><strong>{syncAction(row.command.kind)}</strong><SyncIssue row={row} /><SyncEvidence row={row} /></td><td><StatusBadge status={row.status} /></td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div>
        : <EmptyState title="No pending patient changes">Patient changes saved on this device appear here until submitted.</EmptyState>}
    </section>
    <section className="card workflow-outbox-card">
      <div className="card-heading"><div><h2>Pending laboratory changes</h2><p>Saved orders, collection actions and result drafts.</p></div><Clock3 size={21} /></div>
      {workflowOutbox.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Change</th><th scope="col">Status</th><th scope="col">Saved · IST</th></tr></thead><tbody>{workflowOutbox.map(row => <tr key={row.operationId}><td><strong>{syncAction(row.command.kind)}</strong>{row.command.kind.startsWith('result.') && <Link className="text-link" to={`/results/${row.entityId}`}>Open result draft</Link>}<SyncIssue row={row} /><SyncEvidence row={row} /></td><td><StatusBadge status={row.status} /></td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div>
        : <EmptyState title="No pending laboratory changes">Saved laboratory changes appear here until submitted.</EmptyState>}
    </section>
    <div className="scope-note"><ShieldCheck size={17} /><span>Keep browser data until changes are submitted. Clearing it can remove unsent work. Sign in as the same user to reopen retained drafts.</span></div>
  </>;
}
