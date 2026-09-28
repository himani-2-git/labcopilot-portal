import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Beaker, CheckCheck, ChevronRight, ClipboardList, CloudUpload, FlaskConical, LayoutDashboard, LoaderCircle, LogOut, Menu, PackageCheck, RefreshCw, Settings2, ShieldCheck, UsersRound, Wifi, WifiOff, X } from 'lucide-react';
import { ROLE_LABELS, type AuthSession, type Permission } from '@labcopilot/contracts';
import { patientStore, SessionLockedError, type LocalPatient, type QueuedPatientCommand, type QueuedWorkflowCommand } from '../data/patients';
import { useWorkspaceMotion } from '../lib/motion';
import { api, ApiError } from '../lib/api';
import { EmptyState, ErrorNotice, Loading, errorMessage } from '../components/ui';
import { Dashboard } from '../features/dashboard/Dashboard';
import { PatientEditor, PatientDetail, PatientList, SyncPage } from '../features/patients/PatientPages';
import { AnalyticalWorklistPage, NewResultPage, ResultDetailPage } from '../features/results/ResultsPages';
import { AccessionLookupPage, CatalogPage, CreateOrderPage, OrderDetailPage, OrdersPage, SpecimenDetailPage, SpecimenQueuePage } from '../features/laboratory/LaboratoryPages';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

function Brand() {
  return <div className="brand"><span className="brand-icon"><FlaskConical size={23} aria-hidden="true" /></span><span>LabCopilot<small>LABORATORY WORKSPACE</small></span></div>;
}

export function Login({ onLogin, message, online }: { onLogin: (session: AuthSession) => void; message: string; online: boolean }) {
  const motionRef = useWorkspaceMotion('login', 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    try { const session = await api.login(username.trim(), password); setPassword(''); onLogin(session); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return <main ref={motionRef} className="login-page">
    <div className="login-banner"><Brand /><span className="environment-tag">Demo environment</span></div>
    <div className="login-layout">
      <section className="login-context"><div data-login-reveal className="eyebrow">YOUR LABORATORY WORKSPACE</div><h1 data-login-reveal>One team.<br />One clear workflow.</h1><p data-login-reveal>Keep patients, orders, specimens and results connected, with a history of every change.</p>
        <svg className="workflow-art" viewBox="0 0 520 120" fill="none" aria-hidden="true"><path pathLength="1" d="M14 90 C95 90 68 24 154 24 S235 92 316 92 S419 24 502 24" /><path pathLength="1" d="M14 102 C95 102 68 36 154 36 S235 104 316 104 S419 36 502 36" /><path pathLength="1" d="M14 78 C95 78 68 12 154 12 S235 80 316 80 S419 12 502 12" /><circle cx="154" cy="24" r="6" /><circle cx="316" cy="92" r="6" /><circle cx="502" cy="24" r="6" /></svg><div data-login-reveal className="login-benefits"><div><FlaskConical /><span><strong>From collection to results</strong><small>Find the next step and the records behind it.</small></span></div><div><CloudUpload /><span><strong>Keep work moving</strong><small>Save permitted drafts on this device when the connection drops.</small></span></div></div>
        <p className="login-boundary">Synthetic demonstration data only · Not for clinical use</p>
      </section>
      <section className="login-card" aria-labelledby="login-title"><h2 id="login-title">Sign in to LabCopilot</h2><p>Enter your account details to open your workspace.</p>
        {message && <div className="notice info-notice" role="status">{message}</div>}
        {!online && <ErrorNotice>Connect to the network to sign in and unlock your saved drafts.</ErrorNotice>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <form onSubmit={event => void submit(event)}>
          <div className="field"><label htmlFor="username">Username</label><input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <button className="button button-primary login-submit" disabled={busy || !online}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <details className="demo-accounts"><summary>Development sign-in help</summary><p>This local demo uses development accounts. Select a username below, then enter the password configured in <code>source/.env</code> under <code>DEMO_PASSWORD</code>. Enter its value, not the variable name.</p><div className="account-shortcuts">{[['clerk', 'Registration'], ['technician', 'Laboratory work'], ['approver', 'Read-only inspection'], ['admin', 'Configuration']].map(([name, label]) => <button key={name} type="button" className="button button-ghost" onClick={() => setUsername(name!)}><strong>{name}</strong><small>{label}</small></button>)}</div></details>
      </section>
    </div><footer className="login-footer">LabCopilot · Laboratory workspace</footer>
  </main>;
}

export function App() {
  const online = useOnline();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const unlock = useCallback((next: AuthSession) => { patientStore.unlock(next); setSession(next); setMessage(''); }, []);
  const lock = useCallback((reason: string) => { patientStore.lock(); setSession(null); setMessage(reason); navigate('/login', { replace: true }); }, [navigate]);
  useEffect(() => {
    let current = true;
    void api.session().then(next => { if (current) unlock(next); }).catch(err => {
      if (current && !(err instanceof ApiError && err.status === 401)) setMessage(errorMessage(err));
    }).finally(() => { if (current) setInitializing(false); });
    return () => { current = false; };
  }, [unlock]);
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    const timer = window.setTimeout(() => lock('Your session expired. Sign in online again to unlock your saved drafts.'), delay);
    return () => window.clearTimeout(timer);
  }, [session, lock]);
  if (initializing) return <div className="initial-loading"><Brand /><Loading label="Checking your session…" /></div>;
  if (!session) return <Login online={online} message={message} onLogin={next => { unlock(next); navigate('/', { replace: true }); }} />;
  return <Workspace key={`${session.user.id}:${session.expiresAt}`} session={session} online={online} onLock={lock} />;
}

function Workspace({ session, online, onLock }: { session: AuthSession; online: boolean; onLock: (reason: string) => void }) {
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [outbox, setOutbox] = useState<QueuedPatientCommand[]>([]);
  const [workflowOutbox, setWorkflowOutbox] = useState<QueuedWorkflowCommand[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const location = useLocation();
  const motionRef = useWorkspaceMotion(location.pathname + location.search, 'workspace');
  const can = useCallback((permission: Permission) => session.user.permissions.includes(permission), [session]);
  const handleError = useCallback((err: unknown) => {
    if (err instanceof SessionLockedError || err instanceof ApiError && [401, 403].includes(err.status)) {
      onLock('Your workspace was locked. Sign in again to verify your access. Saved drafts are retained.'); return;
    }
    setError(errorMessage(err));
  }, [onLock]);
  const refreshLocal = useCallback(async () => {
    if (!can('patient:read')) return;
    const [rows, queue, workflowQueue] = await Promise.all([patientStore.list(), patientStore.outbox(), patientStore.workflowOutbox()]);
    setPatients(rows); setOutbox(queue); setWorkflowOutbox(workflowQueue);
  }, [can]);
  const refresh = useCallback(async () => {
    if (!can('patient:read')) return;
    setBusy(true); setError('');
    try {
      await refreshLocal();
      if (navigator.onLine) {
        const rows = await api.patients(session);
        await patientStore.mergeServerPatients(rows, session);
        await refreshLocal();
      }
    } catch (err) { handleError(err); }
    finally { setBusy(false); }
  }, [can, refreshLocal, session, handleError]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setMobileOpen(false); void refreshLocal().catch(handleError); }, [location.pathname, refreshLocal, handleError]);
  const submitPending = async () => {
    setSubmitting(true); setError(''); setNotice('');
    try {
      const patientResult = can('patient:write') ? await patientStore.flushPending(session) : { accepted: 0, remaining: outbox.length, blocked: outbox.filter(row => row.status !== 'pending').length };
      const workflowResult = workflowOutbox.length ? await patientStore.flushWorkflow(session) : { accepted: 0, remaining: 0, blocked: 0 };
      const accepted = patientResult.accepted + workflowResult.accepted;
      const remaining = patientResult.remaining + workflowResult.remaining;
      const blocked = patientResult.blocked + workflowResult.blocked;
      setNotice(`${accepted} change${accepted === 1 ? '' : 's'} saved. ${remaining} remaining on this device${blocked ? `, including ${blocked} needing attention` : ''}.`);
      await refreshLocal();
    } catch (err) { handleError(err); }
    finally { setSubmitting(false); }
  };
  const save = async (demographics: LocalPatient['demographics'], submit: boolean, id?: string) => {
    const row = await patientStore.save(demographics, id);
    await refreshLocal();
    setNotice('Draft saved on this device. Submit pending changes to save them on the server.');
    if (submit && navigator.onLine) await submitPending();
    return row.id;
  };
  const signOut = async () => {
    try { await api.logout(session); onLock('Signed out. Saved drafts are retained for the same user on this device.'); }
    catch { onLock('This device is locked. Server sign-out could not be confirmed; reconnect and sign in to end the server session.'); }
  };
  const guarded = (permission: Permission, element: ReactNode) => can(permission) ? element : <EmptyState title="Access is restricted">Your current role does not have access to this workspace.</EmptyState>;
  const qcView = location.pathname === '/results' && new URLSearchParams(location.search).get('filter') === 'qc_pending';
  const title = location.pathname.startsWith('/results') ? (qcView ? 'QC / Readiness' : 'Results') : location.pathname.startsWith('/patients') ? 'Patients' : location.pathname.startsWith('/sync') ? 'Device & sync' : location.pathname.startsWith('/catalog') ? 'Test catalog' : location.pathname.startsWith('/orders') ? 'Laboratory orders' : location.pathname.startsWith('/specimens') ? 'Specimen queue' : location.pathname.startsWith('/accessions') ? 'Accession lookup' : location.pathname.startsWith('/admin') ? 'Administration' : location.pathname.startsWith('/review') ? 'Review workspace' : 'Dashboard';
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>{mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}<aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><Brand /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button></div><div className="facility-card"><span className="facility-mark">DL</span><div><strong>{session.user.facilityName}</strong><small>Current facility</small></div></div><div className="nav-label">WORKSPACE</div><nav aria-label="Main navigation">
      <NavLink to="/" end><LayoutDashboard size={18} />Dashboard</NavLink>
      {can('patient:read') && <NavLink to="/patients"><UsersRound size={18} />Patients</NavLink>}
      {can('order:read') && <NavLink to="/orders"><ClipboardList size={18} />Orders</NavLink>}
      {can('specimen:read') && <NavLink to="/specimens"><PackageCheck size={18} />Specimens</NavLink>}
      {can('result:read') && <Link to="/results" className={location.pathname.startsWith('/results') && !qcView ? 'active' : ''} aria-current={location.pathname.startsWith('/results') && !qcView ? 'page' : undefined}><Activity size={18} />Results</Link>}
      {can('review:read') && <NavLink to="/review"><CheckCheck size={18} />Review<span className="nav-soon">Unavailable</span></NavLink>}
    </nav>
    {can('patient:read') && <><div className="nav-label nav-group-label">OPERATIONS</div><nav aria-label="Operations">
      {can('catalog:read') && <NavLink to="/catalog"><Beaker size={18} />Test catalog</NavLink>}
      {can('result:read') && <Link to="/results?filter=qc_pending" className={qcView ? 'active' : ''} aria-current={qcView ? 'page' : undefined}><ShieldCheck size={18} />QC / Readiness</Link>}
      <NavLink to="/sync"><CloudUpload size={18} />Device & sync{outbox.length + workflowOutbox.length > 0 && <span className="nav-count">{outbox.length + workflowOutbox.length}</span>}</NavLink>
    </nav></>}
    {can('admin:read') && <><div className="nav-label nav-group-label">ADMINISTRATION</div><nav aria-label="Administration"><NavLink to="/admin"><Settings2 size={18} />Configuration</NavLink></nav></>}
    <div className="sidebar-bottom"><div className="workspace-note"><ShieldCheck size={19} /><div><strong>Synthetic data only</strong><small>Not for clinical use</small></div></div><button className="signout" onClick={() => void signOut()}><LogOut size={17} />Sign out</button></div></aside><div className="main-frame"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-right"><span className={`connection ${online ? 'connection-online' : 'connection-offline'}`} role="status">{online ? <Wifi size={15} /> : <WifiOff size={15} />}{online ? 'Online' : 'Offline'}</span><div className="user-summary"><span className="avatar">{session.user.username.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.displayName}</strong><small>{ROLE_LABELS[session.user.role]}</small></div></div></div></header><div className="development-strip"><span className="status-dot" />Synthetic demonstration data · Not for clinical use</div><main ref={motionRef} id="main-content" className="main-content"><div className="workspace-messages" aria-live="polite">{!online && <div className="notice offline-notice"><WifiOff size={18} /><div><strong>Working offline.</strong> Saved drafts remain on this device. Reconnect and select Submit pending to send changes. Reloading offline locks access until online sign-in.</div></div>}{error && <ErrorNotice>{error}</ErrorNotice>}{notice && <div className="notice success-notice" role="status"><CheckCheck size={18} /><div>{notice}</div><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}</div><Routes><Route path="/" element={<Dashboard session={session} online={online} outbox={outbox} workflowOutbox={workflowOutbox} onError={handleError} />} /><Route path="/patients" element={guarded('patient:read', <PatientList patients={patients} busy={busy} canWrite={can('patient:write')} onRefresh={() => void refresh()} />)} /><Route path="/patients/new" element={guarded('patient:write', <PatientEditor patients={patients} online={online} onSave={save} />)} /><Route path="/patients/:id/edit" element={guarded('patient:write', <PatientEditor patients={patients} online={online} busy={busy} onSave={save} />)} /><Route path="/patients/:id" element={guarded('patient:read', <PatientDetail patients={patients} session={session} online={online} busy={busy} canWrite={can('patient:write')} onError={handleError} />)} /><Route path="/catalog" element={guarded('catalog:read', <CatalogPage session={session} online={online} />)} /><Route path="/orders" element={guarded('order:read', <OrdersPage session={session} online={online} />)} /><Route path="/orders/new" element={guarded('order:write', <CreateOrderPage session={session} patients={patients} online={online} />)} /><Route path="/orders/:id" element={guarded('order:read', <OrderDetailPage session={session} online={online} />)} /><Route path="/specimens" element={guarded('specimen:read', <SpecimenQueuePage session={session} online={online} />)} /><Route path="/specimens/:id" element={guarded('specimen:read', <SpecimenDetailPage session={session} online={online} />)} /><Route path="/accessions" element={guarded('specimen:read', <AccessionLookupPage session={session} online={online} />)} /><Route path="/results" element={guarded('result:read', <AnalyticalWorklistPage session={session} online={online} onError={handleError} />)} /><Route path="/results/new" element={guarded('result:write', <NewResultPage session={session} online={online} onError={handleError} />)} /><Route path="/results/:id" element={guarded('result:read', <ResultDetailPage session={session} online={online} onError={handleError} />)} /><Route path="/sync" element={guarded('patient:read', <SyncPage outbox={outbox} workflowOutbox={workflowOutbox} patients={patients} online={online} canWrite={can('patient:write') || workflowOutbox.length > 0} submitting={submitting} onSubmit={() => void submitPending()} />)} /><Route path="/admin" element={guarded('admin:read', <ScopedPage kind="admin" session={session} online={online} onError={handleError} />)} /><Route path="/review" element={guarded('review:read', <ScopedPage kind="review" session={session} online={online} onError={handleError} />)} /><Route path="/login" element={<Navigate to="/" replace />} /><Route path="*" element={<EmptyState title="Page not found" action={<Link className="button button-primary" to="/">Return to dashboard</Link>}>This page is not part of the current workspace.</EmptyState>} /></Routes></main><footer className="workspace-footer"><span>LabCopilot <span className="footer-divider">/</span> Laboratory workspace</span><span>Facility time: Asia/Kolkata · IST</span></footer></div></div>;
}

function ScopedPage({ kind, session, online, onError }: { kind: 'admin' | 'review'; session: AuthSession; online: boolean; onError: (error: unknown) => void }) {
  const [data, setData] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!online) return;
    setLoading(true); setError('');
    void (kind === 'admin' ? api.adminConfig(session) : api.reviewQueue(session)).then(result => { if (active) setData(result); }).catch(err => { if (active) { setError(errorMessage(err)); onError(err); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, session, online, onError]);
  return <><div className="page-heading"><div><div className="eyebrow">{kind === 'admin' ? 'WORKSPACE ADMINISTRATION' : 'QUALIFIED APPROVER'}</div><h1>{kind === 'admin' ? 'Configuration' : 'Review workspace'}</h1><p>{kind === 'admin' ? 'Read-only configuration for your facility.' : 'Inspect laboratory records available to your role.'}</p></div><span className="tag">{kind === 'admin' ? 'Read-only' : 'Unavailable'}</span></div>{loading ? <Loading /> : error ? <ErrorNotice>{error}</ErrorNotice> : !data ? <EmptyState title="Connection required">Connect to the server to check this authorized scope.</EmptyState> : kind === 'review' ? <section className="card"><EmptyState title="Clinical review is not available" action={<Link className="button button-secondary" to="/results">Inspect results</Link>}>You can inspect results and their history. Clinical approval and report release are not available in this workspace.</EmptyState></section> : <section className="card"><div className="card-heading"><div><h2>Facility settings</h2><p>Configuration reported by the application server.</p></div><Settings2 size={22} /></div><dl className="detail-grid"><div><dt>Facility</dt><dd>{String(data.facilityName)}</dd></div><div><dt>Authentication</dt><dd>Development adapter</dd></div><div><dt>Data policy</dt><dd>{data.syntheticOnly ? 'Synthetic demonstration records only' : 'Check server configuration'}</dd></div><div className="field-wide"><dt>Clinical authority</dt><dd>Administrator access does not grant clinical approval permission.</dd></div></dl></section>}</>;
}

