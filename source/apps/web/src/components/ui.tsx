import type { PropsWithChildren } from 'react';
import { AlertCircle, CheckCircle2, CloudUpload, LoaderCircle, ShieldAlert } from 'lucide-react';
import { ApiError } from '../lib/api';

export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { synced: 'Saved', pending: 'Saved on device', conflict: 'Conflict', rejected: 'Needs attention' };
  const Icon = status === 'synced' ? CheckCircle2 : status === 'pending' ? CloudUpload : AlertCircle;
  return <span className={`status-badge status-${status}`}><Icon size={13} aria-hidden="true" />{label[status] ?? status}</span>;
}

export function ErrorNotice({ children }: PropsWithChildren) {
  return <div className="notice error-notice" role="alert"><AlertCircle size={18} aria-hidden="true" /><div>{children}</div></div>;
}

export function Loading({ label = 'Loading workspace…' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={24} aria-hidden="true" /><span>{label}</span></div>;
}

export function EmptyState({ title, children, action }: PropsWithChildren<{ title: string; action?: React.ReactNode }>) {
  return <div className="empty-state"><div className="empty-icon"><ShieldAlert size={24} aria-hidden="true" /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return 'Conflict — this record was updated elsewhere. Your saved draft is retained. Refresh and compare the record before making another change.';
  if (error instanceof ApiError && error.status === 403) return 'Your account does not have access to this action or record. Saved drafts are retained.';
  return error instanceof Error ? error.message : 'Something went wrong. Your local drafts have been retained.';
}
