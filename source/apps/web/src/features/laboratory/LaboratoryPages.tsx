import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Beaker, Check, ClipboardList, Copy, PackageCheck, QrCode, RefreshCw, Search, ShieldCheck, Truck, XCircle } from 'lucide-react';
import type { AnalyticalResult, AuditRecord, AuthSession, LaboratoryOrder, LaboratoryPanel, LaboratoryTest, OrderCommand, Specimen, SpecimenCommand, SpecimenStatus } from '@labcopilot/contracts';
import { EmptyState, ErrorNotice, Loading, errorMessage, formatDate } from '../../components/ui';
import { patientStore, type LocalPatient } from '../../data/patients';
import { api } from '../../lib/api';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

const statusLabel: Record<SpecimenStatus, string> = { ordered: 'Ordered', collection_pending: 'Collection pending', collected: 'Collected', received_accession_pending: 'Received · decision pending', accepted: 'Accepted', rejected: 'Rejected', recollection_required: 'Recollection required' };
const orderStatusLabel = (status: string) => status === 'ordered' ? 'Ordered' : 'Cancelled';
const short = (id: string) => id.slice(0, 8).toUpperCase();
const typeLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const actionLabel = (action: string) => ({
  'order.create': 'Order created', 'specimen.create': 'Specimen created',
  'specimen.collect': 'Collection recorded', 'specimen.receive': 'Specimen received',
  'specimen.accept': 'Specimen accepted', 'specimen.reject': 'Specimen rejected',
  'specimen.recollect': 'Recollection requested',
}[action] ?? typeLabel(action.replaceAll('.', ' ')));
const command = <T extends OrderCommand | SpecimenCommand>(value: T) => value;

function PageNotice({ children }: { children: React.ReactNode }) { return <div className="notice info-notice"><ShieldCheck size={18} />{children}</div>; }
function WorkflowHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function StatusPill({ status }: { status: string }) { return <span className={`workflow-status workflow-${status}`}>{statusLabel[status as SpecimenStatus] ?? orderStatusLabel(status)}</span>; }
function QRPreview({ value }: { value: string }) { const cells = Array.from({ length: 49 }, (_, index) => { let hash = 0; for (const character of `${value}:${index}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0; return Math.abs(hash) % 3 === 0; }); return <div className="qr-preview" role="img" aria-label={`Demo QR representation for ${value}`}>{cells.map((on, index) => <span key={index} className={on ? 'qr-on' : ''} />)}</div>; }

function AuditEvidence({ audit, version }: { audit: AuditRecord[]; version: number }) {
  return <details className="card audit-evidence"><summary>Audit evidence</summary>
    <p className="subtle-text">Record version {version}. Technical details for tracing changes.</p>
    {audit.length ? <div className="table-scroll"><table><thead><tr><th>Action / actor</th><th>Version</th><th>Timestamp · IST</th><th>Correlation ID</th></tr></thead>
      <tbody>{audit.map(event => <tr key={event.id}><td><strong>{event.action}</strong><small className="table-subtext">{event.actorName}</small></td><td>{event.version}</td><td>{formatDate(event.occurredAt)}</td><td className="identifier">{event.correlationId}</td></tr>)}</tbody>
    </table></div> : <p>No audit events available.</p>}
  </details>;
}

export function CatalogPage({ session, online }: { session: AuthSession; online: boolean }) {
  const [tests, setTests] = useState<LaboratoryTest[]>([]); const [panels, setPanels] = useState<LaboratoryPanel[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { const [nextTests, nextPanels] = await Promise.all([api.catalogTests(session), api.catalogPanels(session)]); setTests(nextTests); setPanels(nextPanels); await patientStore.cacheCatalog(nextTests, nextPanels, session); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } };
  useEffect(() => { if (online) void load(); else void patientStore.cachedCatalog().then(cached => { if (cached) { setTests(cached.tests); setPanels(cached.panels); } }).catch(err => setError(errorMessage(err))).finally(() => setLoading(false)); }, [online, session]);
  return <><WorkflowHeader eyebrow="LABORATORY CATALOG" title="Test catalog" description="Tests, specimen requirements and panels available for ordering." action={<button className="button button-secondary" onClick={() => void load()} disabled={!online || loading}><RefreshCw size={16} />Refresh</button>} />{!online && <PageNotice>Offline — showing the last saved catalog for your workspace.</PageNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}{loading ? <Loading label="Loading test catalog…" /> : <div className="dashboard-grid"><section className="card"><div className="card-heading"><div><h2>Individual tests</h2><p>Test codes, specimen types and units.</p></div><Beaker size={22} /></div>{tests.length ? <div className="catalog-list">{tests.map(test => <div className="catalog-row" key={test.id}><div><strong>{test.name}</strong><small>{test.code} · {typeLabel(test.specimenType)}</small></div><div className="catalog-meta"><span>{test.unit ?? 'Coded / no unit'}</span><span className="tag">{test.status}</span></div></div>)}</div> : <EmptyState title="No active tests">No tests are currently available.</EmptyState>}</section><section className="card"><div className="card-heading"><div><h2>Panels</h2><p>Selections expand to the tests they contain.</p></div><ClipboardList size={22} /></div>{panels.length ? <div className="catalog-list">{panels.map(panel => <div className="catalog-row catalog-panel" key={panel.id}><div><strong>{panel.name}</strong><small>{panel.code} · {panel.description}</small><div className="catalog-items">{panel.items.map(item => <span key={item.id}>{item.testCode}</span>)}</div></div><span className="tag">{panel.items.length} tests</span></div>)}</div> : <EmptyState title="No active panels">No tests are currently available.</EmptyState>}</section></div>}<div className="scope-note"><ShieldCheck size={16} /><span>Synthetic catalog for demonstration only. Not for clinical use.</span></div></>;
}

export function OrdersPage({ session, online }: { session: AuthSession; online: boolean }) {
  const navigate = useNavigate(); const [searchParams] = useSearchParams(); const patientFilter = searchParams.get('patient') ?? ''; const [orders, setOrders] = useState<LaboratoryOrder[]>([]); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => { if (!online) { setLoading(false); return; } setLoading(true); setError(''); try { setOrders(await api.orders(session)); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [online, session]);
  const filtered = useMemo(() => orders.filter(order => (!patientFilter || order.patientId === patientFilter) && `${order.patientName} ${order.id} ${order.items.map(item => item.test?.name ?? item.panel?.name).join(' ')}`.toLowerCase().includes(query.toLowerCase())), [orders, query, patientFilter]);
  return <><WorkflowHeader eyebrow="ORDERS" title="Laboratory orders" description="Requested tests and specimen progress for your patients." action={<div className="button-group"><button className="button button-secondary" onClick={() => void load()} disabled={!online || loading}><RefreshCw size={16} />Refresh</button>{session.user.permissions.includes('order:write') && <Link className="button button-primary" to={patientFilter ? `/orders/new?patient=${patientFilter}` : '/orders/new'}><ClipboardList size={17} />Create order</Link>}</div>} />{!online && <PageNotice>Reconnect to refresh orders. Saved drafts are available in Device & sync.</PageNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}<section className="card">{patientFilter && <div className="card-heading"><div><h2>Patient orders</h2><Link className="text-link" to={`/patients/${patientFilter}`}>Open patient</Link></div><Link className="text-link" to="/orders">Show all orders</Link></div>}<div className="list-toolbar"><div className="search-field"><Search size={17} /><label className="sr-only" htmlFor="order-search">Search orders</label><input id="order-search" type="search" placeholder="Search patient, order or test" value={query} onChange={event => setQuery(event.target.value)} /></div><span className="table-footer">{filtered.length} orders</span></div>{loading ? <Loading /> : filtered.length ? <div className="table-scroll"><table><thead><tr><th>Patient / order</th><th>Requested items</th><th>Priority</th><th>Status</th><th>Specimen</th><th /></tr></thead><tbody>{filtered.map(order => <tr key={order.id}><td><Link className="patient-cell" to={`/orders/${order.id}`}><span className="patient-avatar"><ClipboardList size={16} /></span><span><strong>{order.patientName}</strong><small>{short(order.id)} · {formatDate(order.orderedAt)}</small></span></Link></td><td>{order.items.map(item => <span className="table-chip" key={item.id}>{item.test?.code ?? item.panel?.code}</span>)}</td><td><span className={`priority-${order.priority}`}>{order.priority}</span></td><td><StatusPill status={order.status} /></td><td>{order.specimen ? <><StatusPill status={order.specimen.status} /><small className="table-subtext">{order.specimens.length} collection {order.specimens.length === 1 ? 'attempt' : 'attempts'}</small></> : <span className="subtle-text">Not created</span>}</td><td><button className="table-open" aria-label={`Open order ${short(order.id)}`} onClick={() => navigate(`/orders/${order.id}`)}><ArrowRight size={18} /></button></td></tr>)}</tbody></table></div> : <EmptyState title={query ? 'No matching orders' : 'No orders yet'} action={session.user.permissions.includes('order:write') ? <Link className="button button-primary" to={patientFilter ? `/orders/new?patient=${patientFilter}` : '/orders/new'}><ClipboardList size={16} />Create order</Link> : undefined}>Create an order for a synthetic patient to begin collection.</EmptyState>}<div className="table-footer"><span>Your facility</span><span>Order status is separate from specimen status</span></div></section></>;
}

export function CreateOrderPage({ session, patients, online }: { session: AuthSession; patients: LocalPatient[]; online: boolean }) {
  const navigate = useNavigate(); const [searchParams] = useSearchParams(); const [tests, setTests] = useState<LaboratoryTest[]>([]); const [panels, setPanels] = useState<LaboratoryPanel[]>([]); const [patientId, setPatientId] = useState(() => searchParams.get('patient') ?? ''); const [priority, setPriority] = useState<'routine' | 'urgent'>('routine'); const [note, setNote] = useState(''); const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const loadCatalog = async () => {
      try {
        if (online) {
          const [nextTests, nextPanels] = await Promise.all([api.catalogTests(session), api.catalogPanels(session)]);
          if (!active) return;
          setTests(nextTests); setPanels(nextPanels);
          await patientStore.cacheCatalog(nextTests, nextPanels, session);
        } else {
          const cached = await patientStore.cachedCatalog();
          if (!active || !cached) return;
          setTests(cached.tests); setPanels(cached.panels);
        }
      } catch (err) { if (active) setError(errorMessage(err)); }
    };
    void loadCatalog();
    return () => { active = false; };
  }, [online, session]);
  const toggle = (key: string) => setSelected(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]);
  const save = async () => {
    if (!patientId || !selected.length) { setError('Choose a patient and at least one test or panel.'); return; }
    setBusy(true); setError('');
    try {
      const payload = { patientId, priority, ...(note.trim() ? { note: note.trim() } : {}), items: selected.map(key => key.startsWith('test:') ? { testId: key.slice(5) } : { panelId: key.slice(6) }) };
      const next: OrderCommand = command({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: crypto.randomUUID(), expectedVersion: 0, kind: 'order.create', payload });
      if (!online) {
        await patientStore.queueWorkflow(next);
        navigate('/sync');
        return;
      }
      const result = await api.submitOrder(next, session);
      if (!result.order) throw new Error('The server did not return the created order.');
      navigate(`/orders/${result.order.id}`);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const availablePatients = patients.filter(patient => patient.serverVersion > 0 && patient.syncStatus === 'synced');
  return <><Link className="back-link" to="/orders"><ArrowLeft size={16} />Back to orders</Link><WorkflowHeader eyebrow="ORDER ENTRY" title="Create laboratory order" description="Choose a patient and the tests or panels to collect." action={<span className="tag">{online ? 'Connected' : 'Offline draft'}</span>} />{!online && <PageNotice>Using your saved catalog. The order will stay on this device until you submit it from Device & sync.</PageNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}<div className="editor-layout"><section className="card"><div className="form-body"><div className="form-grid"><div className="field field-wide"><label htmlFor="order-patient">Patient <span aria-hidden="true">*</span></label><select id="order-patient" value={patientId} onChange={event => setPatientId(event.target.value)} disabled={busy}><option value="">Select a patient</option>{availablePatients.map(patient => <option key={patient.id} value={patient.id}>{patient.demographics.displayName} · {short(patient.id)}</option>)}</select>{!availablePatients.length && <small>Register and submit a patient before creating an order.</small>}</div><div className="field"><label htmlFor="order-priority">Priority</label><select id="order-priority" value={priority} onChange={event => setPriority(event.target.value as 'routine' | 'urgent')} disabled={busy}><option value="routine">Routine</option><option value="urgent">Urgent</option></select></div><div className="field field-wide"><label htmlFor="order-note">Order note</label><textarea id="order-note" value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Optional collection or processing instructions" disabled={busy} /></div></div><div className="catalog-picker"><div className="card-heading"><div><h2>Requested tests and panels</h2><p>Select items that use the same specimen type.</p></div><span className="tag">{selected.length} selected</span></div><div className="picker-grid">{tests.map(test => <button type="button" className={`picker-item ${selected.includes(`test:${test.id}`) ? 'picker-selected' : ''}`} key={test.id} onClick={() => toggle(`test:${test.id}`)} disabled={busy}><span className="picker-check">{selected.includes(`test:${test.id}`) && <Check size={14} />}</span><span><strong>{test.name}</strong><small>{test.code} · {typeLabel(test.specimenType)}</small></span></button>)}{panels.map(panel => <button type="button" className={`picker-item ${selected.includes(`panel:${panel.id}`) ? 'picker-selected' : ''}`} key={panel.id} onClick={() => toggle(`panel:${panel.id}`)} disabled={busy}><span className="picker-check">{selected.includes(`panel:${panel.id}`) && <Check size={14} />}</span><span><strong>{panel.name}</strong><small>{panel.code} · {panel.items.length} tests</small></span></button>)}</div></div></div><div className="form-footer"><Link className="button button-ghost" to="/orders">Cancel</Link><button className="button button-primary" onClick={() => void save()} disabled={busy || !patientId || !selected.length}>{busy ? 'Saving…' : online ? 'Create order' : 'Save on device'}</button></div></section><aside className="entry-guidance"><div className="guidance-icon"><ClipboardList size={23} /></div><h2>Before collection</h2><p>Check the patient and requested tests before creating the order.</p><ul><li>Choose active tests or panels.</li><li>Create separate orders for different specimen types.</li><li>Open the order to generate and collect a specimen.</li></ul></aside></div></>;
}

export function OrderDetailPage({ session, online }: { session: AuthSession; online: boolean }) {
  const { id } = useParams(); const navigate = useNavigate(); const [order, setOrder] = useState<LaboratoryOrder>(); const [audit, setAudit] = useState<AuditRecord[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = async () => { if (!id || !online) { setLoading(false); return; } setLoading(true); setError(''); try { const [nextOrder, history] = await Promise.all([api.order(id, session), api.orderHistory(id, session)]); setOrder(nextOrder); setAudit(history.audit); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [id, online, session]);
  // The API returns newest attempts first; render the timeline in collection order.
  const attempts = [...(order?.specimens ?? [])].sort((first, second) => first.attemptNumber - second.attemptNumber);
  const latestAttempt = attempts.at(-1);
  const replacementNeeded = latestAttempt?.status === 'recollection_required';
  const canCreate = order?.status === 'ordered' && (!latestAttempt || replacementNeeded);
  const createSpecimen = async () => {
    if (!order || !canCreate) return;
    if (replacementNeeded && !online) { setError('Reconnect before generating a replacement specimen so the accepted recollection request can be checked.'); return; }
    if (replacementNeeded && !window.confirm(`Create a new physical specimen for order ${short(order.id)}? The previous attempt will remain in the history.`)) return;
    setBusy(true); setError('');
    try {
      const next: SpecimenCommand = command({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: crypto.randomUUID(), expectedVersion: 0, kind: 'specimen.create', payload: { orderId: order.id } });
      if (!online) { await patientStore.queueWorkflow(next); navigate('/sync'); return; }
      const result = await api.submitSpecimen(next, session);
      if (!result.specimen) throw new Error('The server did not return the created specimen.');
      await load();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  if (loading) return <Loading label="Loading order…" />; if (!order) return <EmptyState title="Order unavailable" action={<Link className="button button-secondary" to="/orders">Back to orders</Link>}>{error || 'This order is outside your facility or no longer available.'}</EmptyState>;
  return <>
    <Link className="back-link" to="/orders"><ArrowLeft size={16} />Back to orders</Link>
    <WorkflowHeader eyebrow={`ORDER · ${short(order.id)}`} title={order.patientName} description={`${typeLabel(order.priority)} order · requested by ${order.orderedBy} · ${formatDate(order.orderedAt)}`} action={<StatusPill status={order.status} />} />
    <div className="button-group"><Link className="text-link" to={`/patients/${order.patientId}`}>Open patient <ArrowRight size={15} /></Link>{latestAttempt && <Link className="text-link" to={`/specimens/${latestAttempt.id}`}>Open latest specimen <ArrowRight size={15} /></Link>}</div>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!online && <PageNotice>Offline — showing the order last loaded in this workspace. New actions will be saved on this device.</PageNotice>}
    <div className="detail-layout">
      <section className="card">
        <div className="card-heading"><div><h2>Requested tests and panels</h2><p>{session.user.facilityName}</p></div><ClipboardList size={22} /></div>
        <div className="workflow-items">{order.items.map(item => <div className="workflow-item" key={item.id}><Beaker size={18} /><div><strong>{item.test?.name ?? item.panel?.name}</strong><small>{item.test?.code ?? item.panel?.code} · {item.test ? typeLabel(item.test.specimenType) : `${item.panel?.items.length ?? 0} tests`}</small>{item.panel && <small>{item.panel.items.map(test => test.testName).join(' · ')}</small>}</div></div>)}</div>
        {order.note && <div className="note-block"><strong>Order note</strong><p>{order.note}</p></div>}
      </section>
      <section className="card specimen-card">
        <div className="card-heading"><div><h2>Collection attempts</h2><p>Each specimen is a distinct physical collection. Earlier attempts stay traceable after recollection.</p></div><PackageCheck size={22} /></div>
        {attempts.length ? <div className="attempt-list">{attempts.map(attempt => <div className="attempt-row" key={attempt.id}><div className="attempt-details"><span className="eyebrow">ATTEMPT {attempt.attemptNumber}{attempt.id === latestAttempt?.id ? ' · LATEST' : ' · PRIOR'}</span><strong>{attempt.barcodeValue}</strong>{attempt.accessionIdentifier && <small>Accession {attempt.accessionIdentifier}</small>}</div><StatusPill status={attempt.status} /><Link className="button button-secondary" to={`/specimens/${attempt.id}`}>View attempt <ArrowRight size={15} /></Link></div>)}</div> : <EmptyState title="Specimen not created">Generate a specimen record when the order is ready for collection.</EmptyState>}
        {replacementNeeded && <div className="notice offline-notice replacement-notice"><RefreshCw size={18} /><span>The prior specimen and its rejected accession remain in this order’s history. A new collection needs a new specimen identifier.</span></div>}
        {canCreate && session.user.permissions.includes('specimen:write') && <div className="card-footer"><button className="button button-primary" onClick={() => void createSpecimen()} disabled={busy || (replacementNeeded && !online)}><PackageCheck size={16} />{busy ? 'Creating…' : replacementNeeded ? 'Generate replacement specimen' : 'Generate specimen'}</button>{replacementNeeded && !online && <small>Reconnect to verify the recollection request before creating a replacement.</small>}</div>}
      </section>
    </div>
    <section className="card history-card">
      <div className="card-heading"><div><h2>Order timeline</h2><p>Requested work and its collection handoff.</p></div><Truck size={21} /></div>
      <ol className="revision-timeline">
        <li><span className="timeline-marker"><ClipboardList size={15} /></span><div><div className="revision-heading"><strong>Order created</strong><span>{formatDate(order.orderedAt)}</span></div><p>{order.orderedBy}</p></div></li>
        {attempts.map(attempt => <li key={attempt.id}><span className="timeline-marker"><PackageCheck size={15} /></span><div><div className="revision-heading"><strong>Collection attempt {attempt.attemptNumber}</strong>{attempt.createdAt && <span>{formatDate(attempt.createdAt)}</span>}</div><Link className="text-link" to={`/specimens/${attempt.id}`}>{attempt.barcodeValue} · {statusLabel[attempt.status]} <ArrowRight size={14} /></Link>{attempt.collectedAt && <p>Collected {formatDate(attempt.collectedAt)}</p>}{attempt.receivedAt && <p>Received {formatDate(attempt.receivedAt)} · {attempt.accessionIdentifier}</p>}</div></li>)}
      </ol>
    </section>
    <AuditEvidence audit={audit} version={order.version} />
  </>;
}

export function SpecimenQueuePage({ session, online }: { session: AuthSession; online: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStatuses = (searchParams.get('status') ?? '').split(',').filter(status => status in statusLabel);
  const filter = selectedStatuses.join(',') || 'all';
  const setFilter = (value: string) => setSearchParams(current => { const next = new URLSearchParams(current); if (value === 'all') next.delete('status'); else next.set('status', value); return next; });
  const [specimens, setSpecimens] = useState<Specimen[]>([]); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => { if (!online) { setLoading(false); return; } setLoading(true); setError(''); try { setSpecimens(await api.specimens(session)); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [online, session]);
  const filtered = useMemo(() => specimens.filter(specimen => (filter === 'all' || filter.split(',').includes(specimen.status)) && `${specimen.patientName} ${specimen.barcodeValue} ${specimen.orderId} ${specimen.accession?.identifier ?? ''}`.toLowerCase().includes(query.toLowerCase())), [specimens, filter, query]);
  return <><WorkflowHeader eyebrow="SPECIMEN OPERATIONS" title="Specimen queue" description="Collection, receipt and accession decisions for this facility." action={<div className="button-group"><Link className="button button-secondary" to="/accessions"><Search size={16} />Lookup accession</Link><button className="button button-secondary" onClick={() => void load()} disabled={!online || loading}><RefreshCw size={16} />Refresh</button></div>} />{!online && <PageNotice>Reconnect to refresh specimens. Saved drafts remain available in Device & sync.</PageNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}<section className="card"><div className="list-toolbar"><div className="search-field"><Search size={17} /><label className="sr-only" htmlFor="specimen-search">Search specimens</label><input id="specimen-search" type="search" placeholder="Search patient, barcode or accession" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="toolbar-actions"><label className="sr-only" htmlFor="specimen-filter">Specimen status</label><select id="specimen-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{selectedStatuses.length > 1 && <option value={filter}>{selectedStatuses.map(status => statusLabel[status as SpecimenStatus]).join(' / ')}</option>}{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>{loading ? <Loading /> : filtered.length ? <div className="table-scroll"><table><thead><tr><th>Patient / specimen</th><th>Type</th><th>Status</th><th>Accession</th><th>Updated · IST</th><th /></tr></thead><tbody>{filtered.map(specimen => <tr key={specimen.id}><td><Link className="patient-cell" to={`/specimens/${specimen.id}`}><span className="patient-avatar"><PackageCheck size={16} /></span><span><strong>{specimen.patientName}</strong><small>{specimen.barcodeValue} · attempt {specimen.attemptNumber} · order {short(specimen.orderId)}</small></span></Link></td><td>{typeLabel(specimen.specimenType)}</td><td><StatusPill status={specimen.status} /></td><td>{specimen.accession ? <span className="identifier">{specimen.accession.identifier}</span> : <span className="subtle-text">Pending</span>}</td><td>{formatDate(specimen.updatedAt)}</td><td><Link className="table-open" aria-label={`Open specimen ${specimen.barcodeValue}`} to={`/specimens/${specimen.id}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div> : <EmptyState title={query || filter !== 'all' ? 'No matching specimens' : 'No specimens yet'}>Generate a specimen from an order to begin collection.</EmptyState>}<div className="table-footer"><span>{filtered.length} of {specimens.length} specimens</span><span>Your facility · Identifier lookup</span></div></section></>;
}

export function SpecimenDetailPage({ session, online }: { session: AuthSession; online: boolean }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [specimen, setSpecimen] = useState<Specimen>();
  const [order, setOrder] = useState<LaboratoryOrder>();
  const [results, setResults] = useState<AnalyticalResult[]>([]);
  const [contextError, setContextError] = useState('');
  const [resultsError, setResultsError] = useState('');
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; fromStatus?: string; toStatus: string; action: string; actorName: string; reason?: string; occurredAt: string; correlationId: string }>>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  const canWrite = session.user.permissions.includes('specimen:write');
  const canReadResults = session.user.permissions.includes('result:read');
  const load = async () => {
    if (!id || !online) { setLoading(false); return; }
    setLoading(true); setError(''); setContextError(''); setResultsError('');
    try {
      const [nextSpecimen, history] = await Promise.all([api.specimen(id, session), api.specimenHistory(id, session)]);
      setSpecimen(nextSpecimen); setEvents(history.events); setAudit(history.audit);
      const [orderResponse, resultsResponse] = await Promise.allSettled([
        api.order(nextSpecimen.orderId, session),
        canReadResults ? api.results(session) : Promise.resolve([] as AnalyticalResult[]),
      ]);
      if (orderResponse.status === 'fulfilled') setOrder(orderResponse.value);
      else { setOrder(undefined); setContextError('Ordered tests could not be loaded. Open the order or reconnect to try again.'); }
      if (resultsResponse.status === 'fulfilled') setResults(resultsResponse.value.filter(result => result.specimenId === id));
      else { setResults([]); setResultsError('Results could not be loaded. Open Results to try again.'); }
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id, online, session]);
  const transition = async (kind: SpecimenCommand['kind']) => {
    if (!specimen || !canWrite) return;
    const requiresReason = kind === 'specimen.reject' || kind === 'specimen.recollect';
    if (requiresReason && !reason.trim()) {
      setError(kind === 'specimen.reject' ? 'Enter a rejection reason.' : 'Enter why recollection is required.');
      return;
    }
    const consequentialActions: Partial<Record<SpecimenCommand['kind'], string>> = {
      'specimen.accept': 'Accept this specimen for analytical processing',
      'specimen.reject': 'Reject this specimen',
      'specimen.recollect': 'Request a new collection for this order',
    };
    const consequentialAction = consequentialActions[kind];
    if (consequentialAction && !window.confirm(`${consequentialAction}? ${online ? 'The decision will be recorded now.' : 'The decision will be queued on this device until you submit it.'}`)) return;
    setBusy(true); setError('');
    try {
      const next: SpecimenCommand = command({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: specimen.id, expectedVersion: specimen.version, kind, payload: requiresReason ? { reason: reason.trim() } : {} });
      if (!online) { await patientStore.queueWorkflow(next); navigate('/sync'); return; }
      await api.submitSpecimen(next, session);
      setReason('');
      await load();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const copy = async (value: string) => { await navigator.clipboard?.writeText(value); };
  if (loading) return <Loading label="Loading specimen…" />; if (!specimen) return <EmptyState title="Specimen unavailable" action={<Link className="button button-secondary" to="/specimens">Back to queue</Link>}>{error || 'This specimen is outside your facility or no longer available.'}</EmptyState>;
  const needsReason = specimen.status === 'received_accession_pending' || specimen.status === 'rejected';
  const orderedTests = order?.items.flatMap(item => item.test
    ? [{ itemId: item.id, testId: item.test.id, code: item.test.code, name: item.test.name, panelName: undefined as string | undefined }]
    : (item.panel?.items ?? []).map(test => ({ itemId: item.id, testId: test.testId, code: test.testCode, name: test.testName, panelName: item.panel?.name }))) ?? [];
  return <>
    <Link className="back-link" to="/specimens"><ArrowLeft size={16} />Back to specimen queue</Link>
    <WorkflowHeader eyebrow={`SPECIMEN · ATTEMPT ${specimen.attemptNumber}`} title={specimen.patientName} description={`${typeLabel(specimen.specimenType)} · ${specimen.barcodeValue}`} action={<StatusPill status={specimen.status} />} />
    <div className="button-group"><Link className="text-link" to={`/patients/${specimen.patientId}`}>Open patient <ArrowRight size={15} /></Link><Link className="text-link" to={`/orders/${specimen.orderId}`}>Order {short(specimen.orderId)} <ArrowRight size={15} /></Link></div>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="detail-layout">
      <section className="card">
        <div className="card-heading"><div><h2>Identity & accession</h2><p>Copy an identifier to find this specimen.</p></div><QrCode size={22} /></div>
        <div className="identifier-panel"><QRPreview value={specimen.accession?.identifier ?? specimen.barcodeValue} /><div><span className="eyebrow">SPECIMEN IDENTIFIER</span><strong className="identifier-large">{specimen.barcodeValue}</strong><button className="text-link" onClick={() => void copy(specimen.barcodeValue)}><Copy size={14} />Copy identifier</button>{specimen.accession && <><span className="eyebrow accession-label">ACCESSION</span><strong className="identifier-large">{specimen.accession.identifier}</strong><button className="text-link" onClick={() => void copy(specimen.accession!.identifier)}><Copy size={14} />Copy accession</button></>}</div></div>
        <p className="small-boundary">Illustrative QR only. Use the text identifier for lookup.</p>
        <div className="detail-grid">
          <div><dt>Collected</dt><dd>{specimen.collectedAt ? <>{formatDate(specimen.collectedAt)}<small className="table-subtext">{specimen.collectedBy}</small></> : 'Pending'}</dd></div>
          <div><dt>Received</dt><dd>{specimen.receivedAt ? <>{formatDate(specimen.receivedAt)}<small className="table-subtext">{specimen.receivedBy}</small></> : 'Pending'}</dd></div>
          <div><dt>Facility</dt><dd>{session.user.facilityName}</dd></div>
          <div><dt>Accession decision</dt><dd>{specimen.accession?.decision ? typeLabel(specimen.accession.decision) : 'Pending'}</dd></div>
        </div>
        {specimen.notes && <div className="note-block"><strong>Notes</strong><p>{specimen.notes}</p></div>}
      </section>
      <section className="card">
        <div className="card-heading"><div><h2>Collection & accession</h2><p>{canWrite ? 'Record the next step for this specimen.' : 'Collection and accession status.'}</p></div><PackageCheck size={22} /></div>
        <div className="action-stack">
          {canWrite && <>
            {specimen.status === 'collection_pending' && <button className="button button-primary" onClick={() => void transition('specimen.collect')} disabled={busy}><Check size={16} />Mark collected</button>}
            {specimen.status === 'collected' && <button className="button button-primary" onClick={() => void transition('specimen.receive')} disabled={busy}><Truck size={16} />Receive & generate accession</button>}
            {specimen.status === 'received_accession_pending' && <><button className="button button-primary" onClick={() => void transition('specimen.accept')} disabled={busy}><Check size={16} />Accept specimen</button><button className="button button-danger" onClick={() => void transition('specimen.reject')} disabled={busy}><XCircle size={16} />Reject specimen</button></>}
            {specimen.status === 'rejected' && <button className="button button-primary" onClick={() => void transition('specimen.recollect')} disabled={busy}><RefreshCw size={16} />Request recollection</button>}
            {needsReason && <div className="field"><label htmlFor="specimen-reason">{specimen.status === 'rejected' ? 'Recollection reason' : 'Rejection reason'} <span aria-hidden="true">*</span></label><textarea id="specimen-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Describe why the specimen cannot proceed" /></div>}
          </>}
          {specimen.status === 'accepted' && <div className="notice success-notice"><Check size={18} />Accepted and ready for analytical processing.</div>}
          {specimen.status === 'recollection_required' && <div className="replacement-guidance"><div className="notice offline-notice"><RefreshCw size={18} /><span>This physical specimen remains in the history. Record the next collection as a new specimen on the order.</span></div><Link className="button button-secondary" to={`/orders/${specimen.orderId}`}>Open order for replacement <ArrowRight size={15} /></Link></div>}
          {!canWrite && specimen.status !== 'accepted' && <p className="subtle-text">A collection team member will record the next step.</p>}
          {specimen.rejectionReason && <div className="note-block"><strong>Rejection reason</strong><p>{specimen.rejectionReason}</p></div>}
          {specimen.recollectionReason && <div className="note-block"><strong>Recollection reason</strong><p>{specimen.recollectionReason}</p></div>}
          {!online && <PageNotice>Offline — showing the last loaded specimen. {canWrite ? 'Actions are saved on this device until you submit them from Device & sync.' : 'Reconnect to see updates.'}</PageNotice>}
        </div>
      </section>
    </div>
    <section className="card">
      <div className="card-heading"><div><h2>{canReadResults ? 'Tests & results' : 'Ordered tests'}</h2><p>Tests requested for this specimen.</p></div>{canReadResults && specimen.status === 'accepted' && <Link className="button button-primary" to={`/results?specimen=${specimen.id}`}>Open results <ArrowRight size={16} /></Link>}</div>
      {contextError && <ErrorNotice>{contextError}</ErrorNotice>}
      {resultsError && <ErrorNotice>{resultsError}</ErrorNotice>}
      {orderedTests.length ? <div className="table-scroll"><table><thead><tr><th>Test</th><th>Panel</th>{canReadResults && <><th>Result</th><th>Status</th><th /></>}</tr></thead><tbody>{orderedTests.map(test => {
        const result = results.find(item => item.orderItemId === test.itemId && item.testId === test.testId);
        return <tr key={`${test.itemId}:${test.testId}`}><td><strong>{test.name}</strong><small className="table-subtext">{test.code}</small></td><td>{test.panelName ?? 'Individual test'}</td>{canReadResults && <><td>{resultsError ? 'Unavailable' : result ? `${result.value.value || '—'} ${result.value.unit ?? ''}` : 'Not entered'}</td><td>{result ? <><span className="tag">{typeLabel(result.status)}</span>{result.criticalReviewRequired && <span className="status-badge status-conflict">Critical</span>}</> : <span className="subtle-text">{resultsError ? 'Unavailable' : specimen.status === 'accepted' ? 'Awaiting entry' : 'Awaiting specimen acceptance'}</span>}</td><td>{result && <Link className="text-link" to={`/results/${result.id}`}>Open result <ArrowRight size={15} /></Link>}</td></>}</tr>;
      })}</tbody></table></div> : !contextError && <EmptyState title="No tests available">Open the order to check the requested tests.</EmptyState>}
    </section>
    <section className="card">
      <div className="card-heading"><div><h2>Specimen timeline</h2><p>Collection, receipt and decisions.</p></div><Truck size={21} /></div>
      {events.length ? <ol className="revision-timeline">{events.map(event => <li key={event.id}><span className="timeline-marker"><Check size={15} /></span><div><div className="revision-heading"><strong>{actionLabel(event.action)}</strong><span>{formatDate(event.occurredAt)}</span></div><p>{event.actorName} · {statusLabel[event.toStatus as SpecimenStatus] ?? typeLabel(event.toStatus)}</p>{event.reason && <div className="revision-snapshot"><span>{event.reason}</span></div>}</div></li>)}</ol> : <EmptyState title="No timeline yet">Collection and accession activity will appear here.</EmptyState>}
    </section>
    <AuditEvidence audit={audit} version={specimen.version} />
  </>;
}

export function AccessionLookupPage({ session, online }: { session: AuthSession; online: boolean }) {
  const [identifier, setIdentifier] = useState(''); const [searched, setSearched] = useState(''); const [specimen, setSpecimen] = useState<Specimen>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lookup = async () => { const value = identifier.trim(); if (!value) return; setBusy(true); setError(''); setSpecimen(undefined); try { const match = await api.accession(value, session); setSearched(value); setSpecimen(match); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } };
  const matchedAccession = specimen?.lookupMatchedAccessionId ? specimen.accession : undefined;
  return <><Link className="back-link" to="/specimens"><ArrowLeft size={16} />Back to specimen queue</Link><WorkflowHeader eyebrow="MANUAL LOOKUP" title="Accession lookup" description="Find an exact accession or specimen identifier. Earlier collection attempts remain searchable." /><section className="card lookup-card"><div className="search-field lookup-field"><Search size={19} /><label className="sr-only" htmlFor="accession-lookup">Accession identifier</label><input id="accession-lookup" value={identifier} onChange={event => setIdentifier(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void lookup(); }} placeholder="ACC-DEMO0002" disabled={!online || busy} /><button className="button button-primary" onClick={() => void lookup()} disabled={!online || busy || !identifier.trim()}>{busy ? 'Looking up…' : 'Lookup'}</button></div>{!online && <PageNotice>Reconnect to look up a specimen or accession.</PageNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}{specimen && <div className="lookup-result"><div className="lookup-details"><span className="eyebrow">{matchedAccession ? 'MATCHED ACCESSION' : 'MATCHED SPECIMEN'}</span><h2>{specimen.patientName}</h2><strong className="identifier-large">{matchedAccession?.identifier ?? specimen.barcodeValue}</strong><p>Collection attempt {specimen.attemptNumber} · specimen {specimen.barcodeValue}</p>{matchedAccession && <div className="lookup-facts"><span>Accession decision: <strong>{matchedAccession.decision ? typeLabel(matchedAccession.decision) : 'Pending'}</strong></span><span>Current specimen state: <StatusPill status={specimen.status} /></span></div>}{!matchedAccession && <div className="lookup-facts"><span>Current specimen state: <StatusPill status={specimen.status} /></span>{specimen.accession && <span>Latest accession on this specimen: <strong>{specimen.accession.identifier}</strong></span>}</div>}{specimen.lookupIsHistorical && <div className="notice offline-notice lookup-history-notice"><ShieldCheck size={17} /><span>{searched} is a prior accession for this order. Its exact decision is shown above; open the order to see newer collection attempts.</span></div>}</div><div className="lookup-actions"><Link className="button button-secondary" to={`/specimens/${specimen.id}`}>Open specimen <ArrowRight size={15} /></Link><Link className="text-link" to={`/orders/${specimen.orderId}`}>See all collection attempts <ArrowRight size={15} /></Link></div></div>}</section></>;
}
