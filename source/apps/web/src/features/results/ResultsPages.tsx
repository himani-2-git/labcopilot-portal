import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, Check, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import './results.css';
import type { AnalyticalResult, AnalyticalWorkItem, AuthSession, ResultCommand, ResultDraftCommand, ResultHistory, ResultPolicy, ResultValue } from '@labcopilot/contracts';
import { api, ApiError } from '../../lib/api';
import { patientStore, type QueuedWorkflowCommand } from '../../data/patients';
import { EmptyState, ErrorNotice, Loading, errorMessage, formatDate } from '../../components/ui';

type Props = { session: AuthSession; online: boolean; onError: (error: unknown) => void };
const stateLabels: Record<string, string> = {
  unentered: 'Awaiting entry', draft: 'Draft', entered: 'Entered', validated: 'Validated', analytically_ready: 'Analytically ready',
  not_evaluated: 'Not checked', not_run: 'Not checked', normal: 'Normal', low: 'Low', high: 'High', abnormal: 'Abnormal',
  not_applicable: 'Not applicable', critical: 'Critical', none: 'None detected', passed: 'Passed', failed: 'Failed',
  missing: 'QC not recorded', pass: 'QC passed', fail: 'QC failed', ready: 'Ready', blocked: 'Blocked', pending: 'Pending',
};
const label = (value: string) => stateLabels[value.replace(/^step-/, '')] ?? value.replace(/^step-/, '').replaceAll('_', ' ');
const actionLabels: Record<string, string> = {
  'result.create': 'Draft saved', 'result.revise': 'Result corrected', 'result.enter': 'Result entered',
  'result.validate': 'Validation checked', 'result.qc': 'QC recorded', 'result.readiness': 'Readiness checked',
};
const actionLabel = (value: string) => actionLabels[value] ?? value.replace(/^result\./, '').replaceAll('.', ' ').replaceAll('_', ' ');
const filterLabels: Record<string, string> = {
  all: 'All results', unentered: 'Awaiting entry', draft: 'Drafts', entered: 'Awaiting validation', validated: 'Validated',
  analytically_ready: 'Analytically ready', critical: 'Critical results', abnormal: 'Abnormal results', blocked: 'Readiness blocked', qc_pending: 'QC / readiness attention',
};
export function matchesResultFilter(item: AnalyticalWorkItem, filter: string) {
  const result = item.result;
  if (filter === 'unentered') return !result || result.status === 'draft';
  if (filter === 'critical') return Boolean(result && ['low', 'high'].includes(result.validation.critical));
  if (filter === 'abnormal') return Boolean(result && ['low', 'high', 'abnormal'].includes(result.validation.flag));
  if (filter === 'blocked') return result?.readiness === 'blocked';
  if (filter === 'qc_pending') return Boolean(result && result.status === 'validated'
    && (result.qc.status !== 'pass' || result.readiness === 'blocked'));
  return filter === 'all' || (result?.status ?? 'unentered') === filter;
}
const slotKey = (item: Pick<AnalyticalWorkItem, 'accessionId' | 'orderItemId' | 'testId'>) => `${item.accessionId}:${item.orderItemId}:${item.testId}`;
const isResult = (row: QueuedWorkflowCommand) => row.command.kind === 'result.create' || row.command.kind === 'result.revise';
function pendingFor(item: AnalyticalWorkItem, queue: QueuedWorkflowCommand[]) {
  return queue.find(row => row.entityId === item.result?.id || row.command.kind === 'result.create' && slotKey(row.command.payload) === slotKey(item));
}
export function ResultBadge({ value }: { value: string }) {
  return <span className={`result-badge result-${value}`}>{label(value)}</span>;
}
function Boundary() {
  return <div className="scope-note"><ShieldCheck size={16} /><span>Synthetic results and rules · Analytical readiness does not approve or release a report.</span></div>;
}
function PolicyView({ policy }: { policy: ResultPolicy }) {
  return <details className="result-disclosure result-rule-disclosure"><summary>Rule set used for this result</summary><div className="result-policy"><strong>{policy.label}</strong><small>{policy.valueKind} · expected unit: {policy.expectedUnit ?? 'none'}</small>
    {policy.valueKind === 'numeric' && <p>Synthetic reference: {policy.lower ?? 'no lower limit'} to {policy.upper ?? 'no upper limit'} (inclusive). Critical: {policy.criticalLower ? `≤ ${policy.criticalLower}` : 'no lower threshold'} / {policy.criticalUpper ? `≥ ${policy.criticalUpper}` : 'no upper threshold'}.</p>}
    {policy.allowedValues && <p>Allowed values: {policy.allowedValues.join(', ')}. Expected value: {policy.expectedValue ?? 'not configured'}.</p>}
    <small>Demonstration ranges only; not clinical reference ranges. QC is assessed separately.</small><small>Rule set: {policy.version}</small></div></details>;
}
function ResultLinks({ context }: { context: Pick<AnalyticalWorkItem, 'patientId' | 'patientName' | 'orderId' | 'specimenId' | 'accessionIdentifier'> }) {
  return <div className="result-context-links" aria-label="Related records"><Link to={`/patients/${context.patientId}`}>{context.patientName}</Link><Link to={`/orders/${context.orderId}`}>Order</Link><Link to={`/specimens/${context.specimenId}`}>Specimen · {context.accessionIdentifier}</Link></div>;
}
function ValueFields({ value, policy, onChange, disabled }: { value: ResultValue; policy: ResultPolicy; onChange: (value: ResultValue) => void; disabled?: boolean }) {
  return <div className="form-grid"><div className="field field-wide"><label htmlFor="result-value">Result value ({value.kind})</label>
    {value.kind === 'coded' ? <select id="result-value" value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} disabled={disabled}><option value="">Select a demo code</option>{policy.allowedValues?.map(code => <option key={code}>{code}</option>)}</select>
      : value.kind === 'text' ? <textarea id="result-value" maxLength={2000} value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} disabled={disabled} />
      : <input id="result-value" type="text" inputMode="decimal" maxLength={2000} value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} disabled={disabled} placeholder="Enter an exact decimal, e.g. 15.25" />}
    <small>You can save an incomplete draft. Validate it after entry.</small></div>
    <div className="field"><label htmlFor="result-unit">Unit</label><input id="result-unit" value={value.unit ?? ''} maxLength={40} onChange={e => onChange({ ...value, unit: e.target.value })} disabled={disabled} placeholder={policy.expectedUnit ?? 'No unit'} /><small>Exact match required; units are never converted automatically.</small></div></div>;
}

function useWorklist({ session, online, onError }: Props) {
  const [items, setItems] = useState<AnalyticalWorkItem[]>([]);
  const [queue, setQueue] = useState<QueuedWorkflowCommand[]>([]);
  const [asOf, setAsOf] = useState<string>();
  const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [cached, pending] = await Promise.all([patientStore.cachedAnalyticalWorklist(), patientStore.workflowOutbox()]);
      setItems(cached?.items ?? []); setAsOf(cached?.updatedAt); setQueue(pending.filter(isResult));
      if (online) {
        const rows = await api.resultWorklist(session); await patientStore.cacheAnalyticalWorklist(rows, session);
        setItems(rows); setAsOf(new Date().toISOString());
      }
    } catch (err) { setError(errorMessage(err)); onError(err); }
    finally { setBusy(false); }
  }, [session, online, onError]);
  useEffect(() => { void load(); }, [load]);
  return { items, queue, asOf, busy, error, load };
}

export function AnalyticalWorklistPage(props: Props) {
  const { items, queue, asOf, busy, error, load } = useWorklist(props);
  const [params, setParams] = useSearchParams(); const specimenId = params.get('specimen');
  const [query, setQuery] = useState('');
  const requestedFilter = params.get('filter') ?? 'all';
  const filter = Object.hasOwn(filterLabels, requestedFilter) ? requestedFilter : 'all';
  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('filter'); else next.set('filter', value);
    setParams(next);
  };
  const canWrite = props.session.user.permissions.includes('result:write');
  const filtered = items.filter(item => (!specimenId || item.specimenId === specimenId)
    && `${item.patientName} ${item.testCode} ${item.testName} ${item.accessionIdentifier}`.toLowerCase().includes(query.toLowerCase())
    && matchesResultFilter(item, filter));
  return <><div className="page-heading"><div><div className="eyebrow">LABORATORY WORKLIST</div><h1>{filter === 'qc_pending' ? 'QC / Readiness' : 'Results'}</h1><p>{filter === 'qc_pending' ? 'Validated results needing QC evidence or a readiness check.' : 'Enter results, check validation and follow analytical readiness.'}</p></div><button className="button button-secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />Refresh</button></div>
    <Boundary />{error && <ErrorNotice>{error}</ErrorNotice>}
    {!props.online && <div className="notice offline-notice">{asOf ? `Showing saved results from ${formatDate(asOf)}.` : 'No saved results available.'} Only drafts can be saved offline.</div>}
    {specimenId && <div className="notice info-notice">Showing tests for this specimen. <Link to={`/specimens/${specimenId}`}>Open specimen</Link><Link to="/results">Show all results</Link></div>}
    {queue.length > 0 && <div className="notice info-notice">{queue.length} result {queue.length === 1 ? 'draft' : 'drafts'} saved on this device. <Link to="/sync">Open Device & sync</Link></div>}
    <section className="card"><div className="list-toolbar"><div className="search-field"><Search size={17} /><label className="sr-only" htmlFor="result-search">Search analytical work</label><input id="result-search" type="search" placeholder="Patient, accession or test" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <label className="sr-only" htmlFor="result-filter">Result filter</label><select id="result-filter" value={filter} onChange={e => setFilter(e.target.value)}>{Object.entries(filterLabels).map(([state, text]) => <option key={state} value={state}>{text}</option>)}</select></div>
      {busy ? <Loading label="Loading results…" /> : filtered.length ? <div className="table-scroll"><table><thead><tr><th>Patient / accession</th><th>Test</th><th>Value / flag</th><th>Status</th><th>QC / readiness</th><th>Action</th></tr></thead><tbody>{filtered.map(item => {
        const pending = pendingFor(item, queue); const id = item.result?.id ?? pending?.entityId;
        return <tr key={slotKey(item)}><td><Link className="patient-name" to={`/patients/${item.patientId}`}>{item.patientName}</Link><small className="table-subtext">{item.accessionIdentifier}</small><Link to={`/specimens/${item.specimenId}`} className="text-link">Specimen</Link></td><td><strong>{item.testCode}</strong><small className="table-subtext">{item.testName}</small></td><td>{item.result ? <><span>{item.result.value.value || 'Empty'} {item.result.value.unit}</span><div><ResultBadge value={item.result.validation.flag} />{item.result.criticalReviewRequired && <ResultBadge value="critical" />}</div></> : 'Not entered'}</td><td><ResultBadge value={item.result?.status ?? 'unentered'} />{pending && <small className="table-subtext">{pending.status === 'conflict' ? 'Record changed elsewhere' : pending.status === 'rejected' ? 'Draft needs attention' : 'Draft saved on device'}</small>}</td><td>{item.result ? <><ResultBadge value={item.result.qc.status} /><small className="table-subtext">{label(item.result.readiness)}</small></> : 'Awaiting result'}</td><td>{id ? <Link className="button button-secondary" to={`/results/${id}`}>Open result</Link> : canWrite ? <Link className="button button-primary" to={`/results/new?slot=${encodeURIComponent(slotKey(item))}`}>Enter result</Link> : 'Awaiting entry'}</td></tr>;
      })}</tbody></table></div> : <EmptyState title={filter === 'all' && !query ? 'No results awaiting entry' : 'No matching results'}>{filter === 'all' && !query ? 'Accepted specimens appear here with their requested tests.' : 'Try another filter or search to find a result.'}</EmptyState>}
      <div className="table-footer">{filtered.length} {filtered.length === 1 ? 'test' : 'tests'} · {props.session.user.facilityName} · latest 500 accepted specimens</div></section></>;
}

export function NewResultPage(props: Props) {
  const { items, queue, busy, error: loadError } = useWorklist(props);
  const [params] = useSearchParams(); const navigate = useNavigate();
  const [selected, setSelected] = useState(params.get('slot') ?? '');
  const available = items.filter(item => !item.result && !pendingFor(item, queue));
  const item = available.find(entry => slotKey(entry) === selected);
  const [value, setValue] = useState<ResultValue>({ kind: 'numeric', value: '' });
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (item) setValue({ kind: item.policy.valueKind, value: '', ...(item.policy.expectedUnit ? { unit: item.policy.expectedUnit } : {}) }); }, [item?.testId, item?.accessionId]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!item) return; setSaving(true); setError('');
    try {
      const command: ResultDraftCommand = { protocolVersion: 1, operationId: crypto.randomUUID(), entityId: crypto.randomUUID(), expectedVersion: 0, kind: 'result.create',
        payload: { specimenId: item.specimenId, accessionId: item.accessionId, orderItemId: item.orderItemId, testId: item.testId, value } };
      await patientStore.queueWorkflow(command); navigate(`/results/${command.entityId}`);
    } catch (err) { setError(errorMessage(err)); props.onError(err); }
    finally { setSaving(false); }
  };
  return <><Link className="back-link" to="/results"><ArrowLeft size={16} />Results</Link><div className="page-heading"><div><div className="eyebrow">RESULT ENTRY</div><h1>Enter result</h1><p>Save your draft, then submit it from Device & sync.</p></div></div><Boundary />{loadError && <ErrorNotice>{loadError}</ErrorNotice>}{error && <ErrorNotice>{error}</ErrorNotice>}
    {busy ? <Loading /> : <form className="card" onSubmit={event => void save(event)}><div className="form-body"><div className="field"><label htmlFor="analytical-slot">Accepted test / accession</label><select id="analytical-slot" value={selected} onChange={e => setSelected(e.target.value)} disabled={saving}><option value="">Select an accepted test</option>{available.map(entry => <option key={slotKey(entry)} value={slotKey(entry)}>{entry.patientName} · {entry.accessionIdentifier} · {entry.testCode}</option>)}</select></div>
      {item ? <><div className="result-context-links"><Link to={`/patients/${item.patientId}`}>{item.patientName}</Link><Link to={`/orders/${item.orderId}`}>Order</Link><Link to={`/specimens/${item.specimenId}`}>Specimen · {item.accessionIdentifier}</Link></div><ValueFields value={value} policy={item.policy} onChange={setValue} disabled={saving} /><PolicyView policy={item.policy} /></> : <EmptyState title="Choose a test awaiting entry">Select a test from an accepted specimen. Tests with an existing result or saved draft are listed in Results.</EmptyState>}</div>
      <div className="form-footer"><Link to="/results" className="button button-ghost">Cancel</Link><button className="button button-primary" disabled={saving || !item}>{saving ? 'Saving…' : 'Save draft on device'}</button></div></form>}</>;
}

export function ResultDetailPage(props: Props) {
  const { id = '' } = useParams(); const navigate = useNavigate();
  const [result, setResult] = useState<AnalyticalResult>(); const [history, setHistory] = useState<ResultHistory>();
  const [draftContext, setDraftContext] = useState<AnalyticalWorkItem>();
  const [pending, setPending] = useState<QueuedWorkflowCommand>(); const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState<ResultCommand>();
  const [correction, setCorrection] = useState<ResultValue>({ kind: 'numeric', value: '' });
  const [reason, setReason] = useState(''); const [qcReason, setQcReason] = useState('');
  const canWrite = props.session.user.permissions.includes('result:write');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [cached, queued, worklist] = await Promise.all([patientStore.cachedResult(id), patientStore.workflowOutbox(), patientStore.cachedAnalyticalWorklist()]);
      const draft = queued.find(row => row.entityId === id && isResult(row)); setPending(draft); setResult(cached); setHistory(undefined);
      const createCommand = draft?.command.kind === 'result.create' ? draft.command : undefined;
      setDraftContext(createCommand ? worklist?.items.find(item => slotKey(item) === slotKey(createCommand.payload)) : undefined);
      if (props.online) {
        try {
          const row = await api.result(id, props.session); await patientStore.cacheResult(row, props.session); setResult(row);
          setHistory(await api.resultHistory(id, props.session));
        } catch (err) { if (!(draft?.command.kind === 'result.create' && err instanceof ApiError && err.status === 404)) throw err; }
      }
    } catch (err) { setError(errorMessage(err)); props.onError(err); }
    finally { setBusy(false); }
  }, [id, props.online, props.session, props.onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (result) setCorrection(result.value); }, [result?.id, result?.version]);
  const send = async (command: ResultCommand) => {
    setActing(true); setError(''); setNotice('');
    try {
      const response = await api.submitResult(command, props.session);
      if (!response.result || response.operationId !== command.operationId || response.result.id !== command.entityId
        || response.result.facilityId !== props.session.user.facilityId || response.result.version !== command.expectedVersion + 1) throw new ApiError(502, 'Unrecognized acknowledgment. Retry the same action.');
      await patientStore.cacheResult(response.result, props.session); setUncertain(undefined);
      setResult(response.result);
      setNotice(command.kind === 'result.validate' ? `Validation ${response.result.validation.outcome}.`
        : command.kind === 'result.readiness' ? response.result.readiness === 'ready' ? 'Result is analytically ready.' : 'Readiness is blocked. Check the QC evidence below.'
          : `${actionLabel(command.kind)}.`);
      setHistory(await api.resultHistory(id, props.session));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500 || [408, 429].includes(err.status)) setUncertain(command);
      else setUncertain(undefined);
      setError(errorMessage(err)); props.onError(err);
    } finally { setActing(false); }
  };
  const action = (kind: 'result.enter' | 'result.validate' | 'result.readiness' | 'result.qc', payload: unknown = {}) => {
    if (!result || !props.online || pending || uncertain) return;
    if (['result.readiness', 'result.qc'].includes(kind) && !window.confirm('Record this check for the result? This does not approve or release a report.')) return;
    void send({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: id, expectedVersion: result.version, kind, payload } as ResultCommand);
  };
  const revise = async (event: FormEvent) => {
    event.preventDefault(); if (!result || !window.confirm('Save this correction? After submission, validation and QC must be checked again. The previous result remains in history.')) return;
    setActing(true); setError('');
    try {
      await patientStore.queueWorkflow({ protocolVersion: 1, operationId: crypto.randomUUID(), entityId: id, expectedVersion: result.version,
        kind: 'result.revise', payload: { value: correction, reason } }); navigate('/sync');
    } catch (err) { setError(errorMessage(err)); props.onError(err); }
    finally { setActing(false); }
  };
  const disabled = acting || !props.online || Boolean(pending) || Boolean(uncertain);
  if (busy) return <Loading label="Loading result…" />;
  const draftCommand = pending && (pending.command.kind === 'result.create' || pending.command.kind === 'result.revise') ? pending.command : undefined;
  const context = result ?? draftContext;
  return <>
    <Link className="back-link" to="/results"><ArrowLeft size={16} />Results</Link>
    <div className="page-heading">
      <div><div className="eyebrow">LABORATORY RESULT</div><h1>{context?.testName ?? 'Saved result draft'}</h1><p>{context ? `${context.patientName} · ${context.accessionIdentifier}` : 'Saved on this device · awaiting submission'}</p></div>
      <button className="button button-secondary" onClick={() => void load()} disabled={acting}><RefreshCw size={16} />Refresh</button>
    </div>
    {context && <ResultLinks context={context} />}
    <Boundary />
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {notice && <div className="notice info-notice" role="status">{notice}</div>}
    {uncertain && <div className="notice offline-notice">We could not confirm whether this action was saved. Retry it before continuing.<button className="button button-secondary" disabled={acting || !props.online} onClick={() => void send(uncertain)}>Retry same action</button></div>}
    {draftCommand && <section className="card result-local-draft">
      <div className="card-heading"><div><h2>Draft saved on this device</h2><p>{pending?.status === 'conflict' ? 'This record was updated elsewhere. Review the changes before continuing.' : pending?.status === 'rejected' ? 'This draft needs attention before it can be submitted.' : 'Awaiting submission'}</p></div><Link className="button button-primary" to="/sync">Open Device & sync</Link></div>
      <div className="form-body"><strong>{draftCommand.payload.value.value || '(empty value)'} {draftCommand.payload.value.unit}</strong><p>Submit this draft before entry, validation or QC checks.</p>
        <details className="result-disclosure"><summary>Draft evidence</summary><dl className="result-evidence-list"><div><dt>Operation</dt><dd><code>{draftCommand.operationId}</code></dd></div><div><dt>Expected version</dt><dd>{draftCommand.expectedVersion}</dd></div><div><dt>Command / queue status</dt><dd>{draftCommand.kind} · {pending?.status}</dd></div>{pending?.lastError && <div><dt>Server response</dt><dd>{pending.lastError}</dd></div>}</dl></details>
      </div>
    </section>}
    {!result ? !draftCommand && <EmptyState title="Result unavailable">{error || 'Connect to open this result and save a copy for offline access.'}</EmptyState> : <>
      {result.criticalReviewRequired && <div className="critical-banner" role="alert"><strong>Critical {result.validation.critical} result</strong><p>Synthetic critical threshold reached. Qualified review and follow-up are required. No clinical communication or report release has been recorded.</p></div>}
      {!props.online && <div className="notice offline-notice">Showing the saved result from {formatDate(result.updatedAt)}. Connect to validate it or record QC and readiness checks.</div>}
      <section className="card result-summary">
        <div className="card-heading"><div><h2>Result</h2><p>{result.testCode} · {result.enteredBy ? `Entered by ${result.enteredBy}` : 'Awaiting entry'}{result.enteredAt ? ` · ${formatDate(result.enteredAt)}` : ''}</p></div><Activity size={22} /></div>
        <div className="result-lifecycle" aria-label="Result progress">{['draft', 'entered', 'validated', 'analytically_ready'].map(state => <span key={state} aria-current={state === result.status ? 'step' : undefined}><ResultBadge value={state === result.status ? state : `step-${state}`} /></span>)}</div>
        <dl className="detail-grid">
          <div><dt>Recorded value</dt><dd className="result-measurement">{result.value.value || '(empty)'} <small>{result.value.unit}</small></dd></div>
          <div><dt>Validation</dt><dd><ResultBadge value={result.validation.outcome} /></dd></div>
          <div><dt>Reference flag</dt><dd><ResultBadge value={result.validation.flag} /></dd></div>
          <div><dt>Critical flag</dt><dd>{result.criticalReviewRequired ? <ResultBadge value="critical" /> : label(result.validation.critical)}</dd></div>
          <div><dt>QC</dt><dd><ResultBadge value={result.qc.status} /></dd></div>
          <div><dt>Analytical readiness</dt><dd><ResultBadge value={result.readiness} /></dd></div>
        </dl>
        {result.validation.issues.length > 0 && <ErrorNotice><strong>Validation needs attention. Correct the result before continuing.</strong><ul>{result.validation.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul></ErrorNotice>}
        <div className="result-rule-section"><PolicyView policy={result.policy} /></div>
        {canWrite && <div className="form-footer result-actions">
          <button className="button button-secondary" disabled={disabled || result.status !== 'draft'} onClick={() => action('result.enter')}>Mark entered</button>
          <button className="button button-primary" disabled={disabled || !['entered', 'validated'].includes(result.status)} onClick={() => action('result.validate')}>Validate result</button>
          <button className="button button-primary" disabled={disabled || result.status !== 'validated'} onClick={() => action('result.readiness')}>Check analytical readiness</button>
        </div>}
        <section className="result-qc-section" aria-labelledby="result-qc-title">
          <div className="result-section-heading"><h2 id="result-qc-title">QC / Readiness</h2><ResultBadge value={result.qc.status} /></div>
          <p className="result-section-note">Manual QC check for this synthetic result. Instrument and control measurements are not verified.</p>
          <p>{result.qc.reason ?? 'Record QC evidence before checking analytical readiness.'}</p>
          {result.qc.checkedBy && <p className="result-section-note">{result.qc.checkedBy} · {result.qc.checkedAt && formatDate(result.qc.checkedAt)}</p>}
          {canWrite && <div className="result-qc-form"><div className="field"><label htmlFor="qc-reason">QC check reason</label><textarea id="qc-reason" maxLength={500} value={qcReason} onChange={e => setQcReason(e.target.value)} disabled={disabled} /></div>
            <div className="button-group"><button className="button button-secondary" disabled={disabled || result.status === 'draft' || qcReason.trim().length < 3} onClick={() => action('result.qc', { status: 'pass', reason: qcReason })}>Record QC pass</button><button className="button button-danger" disabled={disabled || result.status === 'draft' || qcReason.trim().length < 3} onClick={() => action('result.qc', { status: 'fail', reason: qcReason })}>Record QC fail</button></div>
          </div>}
        </section>
        {canWrite && <details className="result-disclosure result-correction"><summary>Correct result</summary><form onSubmit={event => void revise(event)}>
          <p className="result-section-note">Previous values remain in history. Submitting a correction requires validation and QC to be checked again.</p>
          <ValueFields value={correction} policy={result.policy} onChange={setCorrection} disabled={acting || Boolean(pending) || Boolean(uncertain)} />
          <div className="field"><label htmlFor="correction-reason">Correction reason</label><textarea id="correction-reason" maxLength={500} required minLength={3} value={reason} onChange={e => setReason(e.target.value)} disabled={acting || Boolean(pending) || Boolean(uncertain)} /></div>
          <div className="button-group"><button className="button button-secondary" disabled={acting || Boolean(pending) || Boolean(uncertain) || reason.trim().length < 3}>Save correction on device</button></div>
        </form></details>}
      </section>
      <section className="card history-card result-history">
        <div className="card-heading"><div><h2>Result history</h2><p>Values, checks and corrections retained with the people who recorded them.</p></div></div>
        {history ? <>
          <ol className="revision-timeline">{history.revisions.map(revision => <li key={revision.id}>
            <span className="timeline-marker"><Check size={14} aria-hidden="true" /></span>
            <div><div className="revision-heading"><strong>{revision.action === 'result.validate' ? `Validation ${revision.snapshot.validation.outcome}` : actionLabel(revision.action)}</strong><span>{formatDate(revision.createdAt)}</span></div><p>{revision.actorName}{revision.reason ? ` · ${revision.reason}` : ''}</p>
              <div className="revision-snapshot"><span>{revision.snapshot.value.value || '(empty)'} {revision.snapshot.value.unit}</span><ResultBadge value={revision.snapshot.status} /><ResultBadge value={revision.snapshot.validation.flag} />{revision.snapshot.criticalReviewRequired && <ResultBadge value="critical" />}<ResultBadge value={revision.snapshot.qc.status} /></div>
            </div>
          </li>)}</ol>
          <details className="result-disclosure result-audit-evidence"><summary>Audit evidence</summary>
            <dl className="result-evidence-list"><div><dt>Result ID</dt><dd><code>{result.id}</code></dd></div><div><dt>Current version</dt><dd>{result.version}</dd></div><div><dt>Rule set</dt><dd>{result.policy.version}</dd></div><div><dt>Order item / test</dt><dd><code>{result.orderItemId} / {result.testId}</code></dd></div></dl>
            <div className="table-scroll"><table><caption>Preserved result revisions</caption><thead><tr><th>Revision</th><th>Previous</th><th>Action</th><th>Rule set / validation</th></tr></thead><tbody>{history.revisions.map(revision => <tr key={revision.id}><td>{revision.version}<small className="identifier table-subtext">{revision.id}</small></td><td>{revision.previousVersion ?? '—'}</td><td>{revision.action}</td><td>{revision.snapshot.policy.version}<small className="table-subtext">{revision.snapshot.validation.issues.map(issue => `${issue.code}: ${issue.message}`).join('; ') || revision.snapshot.validation.outcome}</small></td></tr>)}</tbody></table></div>
            <div className="table-scroll"><table><caption>Audit events</caption><thead><tr><th>Audit action</th><th>Actor / version</th><th>Timestamp</th><th>Correlation</th></tr></thead><tbody>{history.audit.map(event => <tr key={event.id}><td>{event.action}</td><td>{event.actorName} · v{event.version}</td><td>{formatDate(event.occurredAt)}</td><td className="identifier">{event.correlationId}</td></tr>)}</tbody></table></div>
          </details>
        </> : <EmptyState title="Connect to view history">The saved result is still available. Reconnect to load earlier values and audit evidence.</EmptyState>}
      </section>
    </>}
  </>;
}
