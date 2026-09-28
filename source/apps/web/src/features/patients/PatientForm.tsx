import { useState } from 'react';
import { CloudUpload, HardDrive, Info, LoaderCircle } from 'lucide-react';
import type { Patient } from '@labcopilot/contracts';
import { ErrorNotice, errorMessage } from '../../components/ui';

type Demographics = Patient['demographics'];
type Fields = { displayName: string; dateOfBirth: string; sex: string; preferredLanguage: string; synthetic: boolean };
export function validatePatientFields(fields: Fields) {
  if (!fields.displayName.trim().startsWith('Demo ') || fields.displayName.trim().length < 7) return 'Use a synthetic name beginning with “Demo ”, such as Demo Asha Rao.';
  if (fields.displayName.trim().length > 120) return 'Patient name must be 120 characters or fewer.';
  const date = new Date(`${fields.dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fields.dateOfBirth || fields.dateOfBirth > new Date().toISOString().slice(0, 10) || fields.dateOfBirth < '1900-01-01') return 'Enter a valid date of birth from 1900 through today.';
  if (!fields.sex) return 'Select a sex value, or choose Unknown.';
  if (!fields.synthetic) return 'Confirm that this record contains synthetic demonstration data only.';
  return null;
}

export function PatientForm({ initial, online, onSave, onCancel }: {
  initial?: Demographics; online: boolean;
  onSave: (demographics: Demographics, submit: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<Fields>(initial ?? { displayName: '', dateOfBirth: '', sex: '', preferredLanguage: 'en', synthetic: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof Fields, value: string | boolean) => setFields(current => ({ ...current, [key]: value }));
  const save = async (submit: boolean) => {
    const invalid = validatePatientFields(fields);
    if (invalid) { setError(invalid); return; }
    setError(''); setSaving(true);
    try { await onSave({ ...fields, displayName: fields.displayName.trim(), synthetic: true } as Demographics, submit); }
    catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  };
  return <form className="patient-form" noValidate onSubmit={event => { event.preventDefault(); void save(online); }}>
    <div className="card-heading"><div><h2>Patient demographics</h2><p>Required fields are marked with an asterisk.</p></div><span className="tag">Synthetic record</span></div>
    <div className="form-body">
      <div className="notice info-notice"><Info size={18} aria-hidden="true" /><div>Use invented details only. Begin the patient's name with <strong>Demo</strong> to identify the record as synthetic.</div></div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="form-grid">
        <div className="field field-wide"><label htmlFor="patient-name">Display name <span aria-hidden="true">*</span></label><input id="patient-name" autoComplete="off" value={fields.displayName} onChange={e => update('displayName', e.target.value)} placeholder="Demo Asha Rao" maxLength={120} required aria-describedby="name-help" /><small id="name-help">An invented name, prefixed with “Demo ”.</small></div>
        <div className="field"><label htmlFor="patient-dob">Date of birth <span aria-hidden="true">*</span></label><input id="patient-dob" type="date" value={fields.dateOfBirth} onChange={e => update('dateOfBirth', e.target.value)} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} required /></div>
        <div className="field"><label htmlFor="patient-sex">Sex <span aria-hidden="true">*</span></label><select id="patient-sex" value={fields.sex} onChange={e => update('sex', e.target.value)} required><option value="">Select sex</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="unknown">Unknown</option></select></div>
        <div className="field"><label htmlFor="patient-language">Preferred report language</label><select id="patient-language" value={fields.preferredLanguage} onChange={e => update('preferredLanguage', e.target.value)}><option value="en">English</option><option value="hi">Hindi</option></select><small>Records the patient’s language preference.</small></div>
      </div>
      <label className="checkbox-field"><input type="checkbox" checked={fields.synthetic} onChange={e => update('synthetic', e.target.checked)} /><span>I confirm this record contains synthetic demonstration data only. <strong>No real patient information.</strong></span></label>
    </div>
    <div className="form-footer"><button type="button" className="button button-ghost" onClick={onCancel} disabled={saving}>Cancel</button><div className="button-group">{online && <button type="button" className="button button-secondary" disabled={saving} onClick={() => void save(false)}><HardDrive size={16} />Save on device</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : online ? <CloudUpload size={16} /> : <HardDrive size={16} />}{saving ? 'Saving…' : online ? 'Save & submit draft' : 'Save draft on device'}</button></div></div>
    <p className="form-note">{online ? 'Every draft is saved on this device before it is submitted to the server.' : 'You are offline. The draft will stay on this device until you submit it after reconnecting.'}</p>
  </form>;
}
