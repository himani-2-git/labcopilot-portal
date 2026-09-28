import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Plus } from 'lucide-react';
import type { AnalyticalWorkItem, AuthSession, Specimen } from '@labcopilot/contracts';
import type { QueuedPatientCommand, QueuedWorkflowCommand } from '../../data/patients';
import { api, ApiError } from '../../lib/api';
import { EmptyState, errorMessage, formatDate } from '../../components/ui';

export function attentionCounts(specimens: Specimen[], work: AnalyticalWorkItem[]) {
  return {
    collection: specimens.filter(s => ['ordered', 'collection_pending', 'recollection_required'].includes(s.status)).length,
    accession: specimens.filter(s => s.status === 'collected').length,
    decision: specimens.filter(s => s.status === 'received_accession_pending').length,
    entry: work.filter(w => !w.result || w.result.status === 'draft').length,
    validation: work.filter(w => w.result?.status === 'entered').length,
    abnormal: work.filter(w => ['low', 'high', 'abnormal'].includes(w.result?.validation.flag ?? '')).length,
    critical: work.filter(w => ['low', 'high'].includes(w.result?.validation.critical ?? '')).length,
    qc: work.filter(w => w.result?.status === 'validated' && (w.result.qc.status !== 'pass' || w.result.readiness === 'blocked')).length,
    blocked: work.filter(w => w.result?.readiness === 'blocked').length,
  };
}

type Snapshot<T> = { rows?: T[]; updatedAt?: string; error?: string; loading: boolean };
type Props = {
  session: AuthSession; online: boolean; outbox: QueuedPatientCommand[]; workflowOutbox: QueuedWorkflowCommand[];
  onError: (error: unknown) => void;
};
export function Dashboard({ session, online, outbox, workflowOutbox, onError }: Props) {
  const [specimens, setSpecimens] = useState<Snapshot<Specimen>>({ loading: true });
  const [work, setWork] = useState<Snapshot<AnalyticalWorkItem>>({ loading: true });
  const canSpecimens = session.user.permissions.includes('specimen:read');
  const canResults = session.user.permissions.includes('result:read');
  const canPatients = session.user.permissions.includes('patient:read');
  const [refreshKey, setRefreshKey] = useState(0);
  const reportError = useCallback((error: unknown) => {
    if (error instanceof ApiError && [401, 403].includes(error.status)) onError(error);
  }, [onError]);
  useEffect(() => {
    let active = true;
    if (!online) {
      setSpecimens(previous => ({ ...previous, loading: false }));
      setWork(previous => ({ ...previous, loading: false }));
      return;
    }
    if (canSpecimens) {
      setSpecimens(previous => ({ ...previous, loading: true, error: undefined }));
      void api.specimens(session).then(rows => {
        if (active) setSpecimens({ rows, loading: false, updatedAt: new Date().toISOString() });
      }).catch(error => {
        if (active) { setSpecimens(previous => ({ ...previous, loading: false, error: errorMessage(error) })); reportError(error); }
      });
    }
    if (canResults) {
      setWork(previous => ({ ...previous, loading: true, error: undefined }));
      void api.resultWorklist(session).then(rows => {
        if (active) setWork({ rows, loading: false, updatedAt: new Date().toISOString() });
      }).catch(error => {
        if (active) { setWork(previous => ({ ...previous, loading: false, error: errorMessage(error) })); reportError(error); }
      });
    }
    return () => { active = false; };
  }, [session, online, canSpecimens, canResults, refreshKey, reportError]);
  const counts = attentionCounts(specimens.rows ?? [], work.rows ?? []);
  const local = [...outbox, ...workflowOutbox];
  const pending = local.filter(row => row.status === 'pending').length;
  const conflicts = local.filter(row => row.status === 'conflict').length;
  const rejected = local.filter(row => row.status === 'rejected').length;
  const loading = (canSpecimens && specimens.loading) || (canResults && work.loading);
  return <>
    <div className="page-heading"><div><div className="eyebrow">LABORATORY WORKSPACE</div><h1>Dashboard</h1><p>What needs your attention at {session.user.facilityName}.</p></div><div className="button-group">
      {canPatients && <button className="button button-ghost" disabled={!online || loading} onClick={() => setRefreshKey(key => key + 1)}><RefreshCw size={16} className={loading ? 'spin' : ''} />Refresh queues</button>}
      {session.user.permissions.includes('patient:write') && <Link className="button button-primary" to="/patients/new"><Plus size={16} />Create patient</Link>}
    </div></div>
    {!canPatients ? <section className="card"><EmptyState title="Facility administration" action={<Link className="button button-primary" to="/admin">Open configuration</Link>}>View your facility configuration. Laboratory records require a laboratory role.</EmptyState></section> : <>
      <div className="workflow-ribbon" aria-label="Laboratory workflow"><Link to="/patients">Patients</Link><ArrowRight size={14} /><Link to="/orders">Orders</Link><ArrowRight size={14} /><Link to="/specimens">Specimens</Link><ArrowRight size={14} />{canResults ? <Link to="/results">Results & validation</Link> : <span>Results & validation · Laboratory team</span>}<ArrowRight size={14} /><span>Review & reports · Unavailable</span></div>
      {canSpecimens && <section className="card attention-section" aria-labelledby="specimen-attention"><div className="card-heading"><div><h2 id="specimen-attention">Specimen work</h2><QueueStatus snapshot={specimens} online={online} /></div><Link className="text-link" to="/accessions">Scan / accession lookup <ArrowRight size={14} /></Link></div>
        <div className="attention-grid">
          <Attention title="Awaiting collection" count={specimens.rows ? counts.collection : undefined} loading={specimens.loading} to="/specimens?status=ordered,collection_pending,recollection_required" hint="Includes requested recollections" />
          <Attention title="Awaiting accession" count={specimens.rows ? counts.accession : undefined} loading={specimens.loading} to="/specimens?status=collected" hint="Collected, waiting to be received" />
          <Attention title="Awaiting decision" count={specimens.rows ? counts.decision : undefined} loading={specimens.loading} to="/specimens?status=received_accession_pending" hint="Receive complete; accept or reject" />
        </div></section>}
      {canResults && <section className="card attention-section" aria-labelledby="result-attention"><div className="card-heading"><div><h2 id="result-attention">Results needing attention</h2><QueueStatus snapshot={work} online={online} /></div><Link className="text-link" to="/results">Open worklist <ArrowRight size={14} /></Link></div>
        <div className="attention-grid">
          <Attention title="Awaiting result entry" count={work.rows ? counts.entry : undefined} loading={work.loading} to="/results?filter=unentered" hint="Unstarted tests and saved drafts" />
          <Attention title="Awaiting validation" count={work.rows ? counts.validation : undefined} loading={work.loading} to="/results?filter=entered" hint="Entered results needing a check" />
          <Attention title="Abnormal results" count={work.rows ? counts.abnormal : undefined} loading={work.loading} to="/results?filter=abnormal" hint="Flagged by synthetic rules" />
          <Attention title="Critical results" count={work.rows ? counts.critical : undefined} loading={work.loading} to="/results?filter=critical" hint="Downstream clinical review required" urgent />
          <Attention title="QC / Readiness" count={work.rows ? counts.qc : undefined} loading={work.loading} to="/results?filter=qc_pending" hint="Validated results needing QC or readiness checks" />
          <Attention title="Blocked results" count={work.rows ? counts.blocked : undefined} loading={work.loading} to="/results?filter=blocked" hint="Validation, QC or readiness blocks" urgent />
        </div></section>}
      <section className="card attention-section"><div className="card-heading"><div><h2>Work saved on this device</h2><p>Changes for your current account and facility.</p></div><Link className="text-link" to="/sync">Device & sync <ArrowRight size={14} /></Link></div><div className="attention-grid">
        <Attention title="Ready to send" count={pending} to="/sync" hint="Submit manually when connected" />
        <Attention title="Sync conflicts" count={conflicts} to="/sync" hint="Record changed elsewhere; draft retained" urgent />
        <Attention title="Changes needing attention" count={rejected} to="/sync" hint="Not accepted; saved draft retained" urgent />
      </div></section>
      <p className="dashboard-scope">Queue counts cover the latest 500 specimens loaded for this facility; result counts cover tests on the latest 500 accepted specimens. Categories can overlap. Counts are not facility-wide totals. Review and reporting are not available.</p>
    </>}
  </>;
}

function QueueStatus<T>({ snapshot, online }: { snapshot: Snapshot<T>; online: boolean }) {
  if (snapshot.loading) return <p role="status">Refreshing queue…</p>;
  if (snapshot.error) return <p role="alert" className="queue-error">{snapshot.error} {snapshot.rows ? 'Showing the last loaded queue.' : 'Counts are unavailable.'}</p>;
  if (!online) return <p role="status">{snapshot.updatedAt ? `Offline · Last loaded ${formatDate(snapshot.updatedAt)}. Counts may have changed.` : 'Connect to load this queue. Counts are unavailable offline.'}</p>;
  return <p>{snapshot.updatedAt ? `Updated ${formatDate(snapshot.updatedAt)}` : 'Queue not yet loaded.'}</p>;
}

function Attention({ title, count, to, hint, urgent, loading }: { title: string; count?: number; to: string; hint: string; urgent?: boolean; loading?: boolean }) {
  return <Link className={`attention-item ${urgent && count ? 'attention-urgent' : ''}`} to={to}><span>{title}</span><strong aria-label={count === undefined ? 'Count unavailable' : undefined}>{count ?? (loading ? '…' : '—')}</strong><small>{hint}</small><ArrowRight size={16} aria-hidden="true" /></Link>;
}
