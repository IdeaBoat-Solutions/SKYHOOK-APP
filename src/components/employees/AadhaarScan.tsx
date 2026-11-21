import React, { useRef, useState } from 'react';
import {
  ScanLine,
  X,
  Upload,
  FileText,
  ImageIcon,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { ParsedAadhaar, maskAadhaar, scanAadhaarDocuments } from '../../utils/aadhaarOcr';
import { isPdf } from '../../utils/ocrEngine';

import { DateInput } from '../common/DateInput';
const MAX_FILES = 3;
const MAX_BYTES = 10 * 1024 * 1024;

export interface AadhaarOutcome {
  name?: string;
  dateOfBirth?: string;
  address?: string;
  files: File[];
}

interface Props {
  onClose: () => void;
  onApply: (outcome: AadhaarOutcome) => void;
}

const formatSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`);

/** Read an Aadhaar card (front + back photos, or the e-Aadhaar PDF) to fill the employee's personal details. */
export const AadhaarScanModal: React.FC<Props> = ({ onClose, onApply }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<'select' | 'scanning' | 'review'>('select');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedAadhaar>({});
  const [lowConfidence, setLowConfidence] = useState(false);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !(isPdf(f) || f.type.startsWith('image/')));
    if (bad) return setError(`"${bad.name}" is not a PDF or photo.`);
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) return setError(`"${big.name}" is over 10 MB.`);
    setError('');
    setFiles((p) => [...p, ...picked].slice(0, MAX_FILES));
  };

  const runScan = async () => {
    setError('');
    setPhase('scanning');
    setProgress(0);
    setStatus('Preparing…');
    try {
      const r = await scanAadhaarDocuments(files, (p) => {
        setProgress(p.progress);
        if (p.status) setStatus(p.status.charAt(0).toUpperCase() + p.status.slice(1));
      });
      setParsed(r.parsed);
      setLowConfidence(r.confidence < 60);
      setName(r.parsed.name ?? '');
      setDob(r.parsed.dateOfBirth ?? '');
      setAddress(r.parsed.address ?? '');
      setPhase('review');
    } catch (e) {
      setError(`Could not read the card (${e instanceof Error ? e.message : 'unknown error'}). You can type the details instead.`);
      setPhase('select');
    }
  };

  const manual = () => {
    setParsed({});
    setName('');
    setDob('');
    setAddress('');
    setLowConfidence(false);
    setPhase('review');
  };

  const found = [parsed.name, parsed.dateOfBirth ?? parsed.yearOfBirth, parsed.address, parsed.number].filter(Boolean).length;

  return (
    <div className="modal-overlay">
      <div className="modal-panel modal-panel-wide text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <span className="section-icon"><ScanLine className="h-4 w-4" /></span>
            <div>
              <h3 className="modal-title">Scan Aadhaar card</h3>
              <p className="text-[11px] text-ink-500">Upload both sides (or the e-Aadhaar PDF) and the personal details fill in.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="modal-body space-y-4 sm:max-h-[72vh]">
          {error && (
            <div className="alert-banner" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs">{error}</span>
            </div>
          )}

          {phase !== 'review' && (
            <>
              <input
                ref={input}
                type="file"
                multiple
                accept="application/pdf,.pdf,image/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
              {phase === 'scanning' ? (
                <div role="status" className="rounded-xl border border-line bg-surface-muted p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-logo-50 text-logo-700 ring-1 ring-logo-100">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-ink-800">{status}</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-logo-700">{Math.round(progress * 100)}%</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500">The first scan downloads the reading engine (a few MB).</p>
                    </div>
                  </div>
                  <div className="progress mt-4"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                  className={`flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-500 ${
                    dragging ? 'border-logo-500 bg-logo-50' : 'border-line-strong bg-surface-muted/60 hover:border-logo-400 hover:bg-logo-50/50'
                  }`}
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dragging ? 'bg-logo-600 text-white ring-logo-600' : 'bg-surface text-logo-700 ring-line'}`}>
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      {dragging ? 'Drop to add' : <>Drop the Aadhaar here, or <span className="text-logo-700 underline decoration-logo-300 underline-offset-2">browse</span></>}
                    </span>
                    <span className="block text-xs text-ink-500">Front and back photos, or the e-Aadhaar PDF. Both sides are read and combined.</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {['PDF', 'JPG', 'PNG'].map((t) => (
                      <span key={t} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-600">{t}</span>
                    ))}
                    <span className="text-[11px] text-ink-400">· up to {MAX_FILES} files, 10 MB each</span>
                  </span>
                </button>
              )}

              {files.length > 0 && (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${isPdf(f) ? 'bg-danger-50 text-danger-700' : 'bg-logo-50 text-logo-700'}`}>
                        {isPdf(f) ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink-800" title={f.name}>{f.name}</span>
                        <span className="block text-[11px] text-ink-500">{isPdf(f) ? 'PDF document' : 'Photo'} · {formatSize(f.size)}</span>
                      </span>
                      <button type="button" disabled={phase === 'scanning'} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="icon-btn shrink-0" aria-label={`Remove ${f.name}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {phase === 'review' && (
            <>
              <div className={`flex items-start gap-2 rounded-lg border p-3 ${found === 0 || lowConfidence ? 'border-warning-600/40 bg-warning-50 text-warning-800' : 'border-success-600/30 bg-success-50 text-success-800'}`}>
                {found === 0 || lowConfidence ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="text-xs">
                  {files.length === 0
                    ? 'Type the details below.'
                    : found === 0
                      ? 'Nothing could be read. Try a flatter, sharper photo, or type the details below.'
                      : `${lowConfidence ? 'The scan was hard to read. ' : ''}Check every field against the card before using it.`}
                </span>
              </div>

              {parsed.number && (
                <div className="flex items-center justify-between rounded-lg border border-line bg-surface-muted px-3 py-2">
                  <span className="text-ink-500">Aadhaar number read</span>
                  <span className="font-mono text-sm font-semibold tracking-wider text-ink-800">{maskAadhaar(parsed.number)}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="aad-name">Full name</label>
                  <input id="aad-name" className="form-input font-semibold" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="form-label" htmlFor="aad-dob">
                    Date of birth{parsed.yearOfBirth && !parsed.dateOfBirth ? ` (card shows year ${parsed.yearOfBirth} only)` : ''}
                  </label>
                  <DateInput id="aad-dob" className="form-input" value={dob} onChange={(e) => setDob(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label" htmlFor="aad-addr">Address</label>
                  <textarea id="aad-addr" rows={3} className="form-input" value={address} onChange={(e) => setAddress(e.target.value.toUpperCase())} />
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
                <FileText className="h-3.5 w-3.5" />
                {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} will be stored with the employee record. The Aadhaar number itself is not saved.` : 'No file added.'}
              </p>
            </>
          )}
        </div>

        <div className="modal-footer flex-wrap">
          <span className="mr-auto flex items-center gap-1.5 text-[11px] text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-success-600" />
            Read on this device, never sent to an OCR service
          </span>
          {phase === 'review' ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('select')}>
                <RotateCcw className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onApply({ name: name.trim() || undefined, dateOfBirth: dob || undefined, address: address.trim() || undefined, files })}
              >
                <CheckCircle2 className="h-4 w-4" /> Use these details
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={phase === 'scanning'}>Cancel</button>
              <button type="button" className="btn btn-secondary" onClick={manual} disabled={phase === 'scanning'}>Enter manually</button>
              <button type="button" className="btn btn-primary" onClick={runScan} disabled={phase === 'scanning' || !files.length}>
                <ScanLine className="h-4 w-4" /> {phase === 'scanning' ? 'Reading…' : 'Read Aadhaar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
