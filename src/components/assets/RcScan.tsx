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
  Check,
  Loader2,
} from 'lucide-react';
import type { MachineType, RcDetails } from '../../types';
import { ParsedRc, scanRcDocuments } from '../../utils/rcOcr';
import { isPdf } from '../../utils/ocrEngine';
import { DateInput } from '../common/DateInput';

const MACHINE_TYPES: MachineType[] = [
  'Hydraulic Crane', 'Mobile Crane', 'Crawler Crane', 'Tower Crane', 'Hydra',
  'All Terrain Crane', 'Rough Terrain Crane', 'Other',
];

const MAX_FILES = 4;
const MAX_BYTES = 10 * 1024 * 1024;

const READ_FIELDS = [
  'Registration no.', 'Chassis no.', 'Engine no.', 'Make & model', 'Crane type',
  'Owner & address', 'Registration validity', 'Financier', 'Weight & specs',
];

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

const STEPS = ['Upload RC', 'Review details', 'Fill asset form'];

/** Three-step progress indicator: upload -> review -> form. */
const Stepper: React.FC<{ current: number }> = ({ current }) => (
  <ol className="flex items-center gap-2" aria-label="Progress">
    {STEPS.map((label, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              done
                ? 'bg-success-600 text-white'
                : active
                  ? 'bg-logo-700 text-white'
                  : 'bg-surface-muted text-ink-500 ring-1 ring-line'
            }`}
            aria-current={active ? 'step' : undefined}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={`truncate text-xs font-semibold ${active ? 'text-ink-900' : 'hidden text-ink-500 sm:inline'}`}>{label}</span>
          {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-line sm:block" />}
        </li>
      );
    })}
  </ol>
);

/* -------------------------------------------------------------------------- */
/* RC detail fields (scan review + asset form)                                 */
/* -------------------------------------------------------------------------- */

type TextKey = {
  [K in keyof RcDetails]-?: NonNullable<RcDetails[K]> extends string ? K : never;
}[keyof RcDetails];
type NumberKey = {
  [K in keyof RcDetails]-?: NonNullable<RcDetails[K]> extends number ? K : never;
}[keyof RcDetails];

type Field =
  | { key: TextKey; label: string; kind?: 'text' | 'date'; wide?: boolean; mono?: boolean; placeholder?: string }
  | { key: NumberKey; label: string; kind: 'number'; step?: string };

/** RC fields grouped the way the card reads, so long forms stay scannable. */
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Registration',
    fields: [
      { key: 'chassisNumber', label: 'Chassis no.', mono: true, placeholder: '17-character VIN' },
      { key: 'engineNumber', label: 'Engine / motor no.', mono: true },
      { key: 'registrationDate', label: 'Registered on', kind: 'date' },
      { key: 'registrationValidUpto', label: 'Valid till', kind: 'date' },
      { key: 'registrationAuthority', label: 'Registration authority (RTO)', wide: true },
      { key: 'ownerSerial', label: 'Owner serial', kind: 'number' },
    ],
  },
  {
    title: 'Owner & finance',
    fields: [
      { key: 'ownerName', label: 'Registered owner', wide: true },
      { key: 'ownership', label: 'Ownership', placeholder: 'FIRM / INDIVIDUAL' },
      { key: 'financier', label: 'Financier (hypothecation)' },
      { key: 'ownerAddress', label: 'Owner address', wide: true },
    ],
  },
  {
    title: 'Vehicle',
    fields: [
      { key: 'makerName', label: "Maker's name (as on RC)", wide: true },
      { key: 'vehicleClass', label: 'Vehicle class', wide: true },
      { key: 'bodyType', label: 'Body type' },
      { key: 'colour', label: 'Colour' },
      { key: 'fuel', label: 'Fuel', placeholder: 'DIESEL' },
      { key: 'emissionNorms', label: 'Emission norms', placeholder: 'BHARAT STAGE III (CEV)' },
      { key: 'manufactureMonthYear', label: 'Month-year of mfg.', placeholder: 'MM-YYYY' },
    ],
  },
  {
    title: 'Specifications',
    fields: [
      { key: 'unladenWeightKg', label: 'Unladen weight (kg)', kind: 'number' },
      { key: 'cubicCapacityCc', label: 'Cubic capacity (cc)', kind: 'number', step: '0.01' },
      { key: 'horsePower', label: 'Power (BHP/kW)', kind: 'number', step: '0.01' },
      { key: 'wheelBaseMm', label: 'Wheel base (mm)', kind: 'number' },
      { key: 'cylinders', label: 'Cylinders', kind: 'number' },
      { key: 'seatingCapacity', label: 'Seating (in all)', kind: 'number' },
    ],
  },
];

interface FieldsProps {
  value: RcDetails;
  onChange: (patch: Partial<RcDetails>) => void;
}

/** Every RC detail, editable by hand (also used to correct a scan). */
export const RcDetailsFields: React.FC<FieldsProps> = ({ value, onChange }) => (
  <div className="space-y-4">
    {GROUPS.map((group) => (
      <fieldset key={group.title} className="rounded-xl border border-line p-3.5">
        <legend className="stat-label px-1.5">{group.title}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {group.fields.map((f) => (
            <div
              key={f.key}
              className={
                f.key === 'ownerAddress'
                  ? 'sm:col-span-2 lg:col-span-4'
                  : 'wide' in f && f.wide
                    ? 'sm:col-span-2'
                    : undefined
              }
            >
              <label className="form-label" htmlFor={`rc-${f.key}`}>{f.label}</label>
              {f.kind === 'number' ? (
                <input
                  id={`rc-${f.key}`}
                  type="number"
                  min={0}
                  step={f.step ?? '1'}
                  className="form-input tabular-nums"
                  value={value[f.key] ?? ''}
                  onChange={(e) => onChange({ [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              ) : f.kind === 'date' ? (
                <DateInput
                  id={`rc-${f.key}`}
                  className="form-input"
                  value={value[f.key] ?? ''}
                  onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}
                />
              ) : (
                <input
                  id={`rc-${f.key}`}
                  type="text"
                  className={`form-input ${f.mono ? 'font-mono tracking-wide' : ''}`}
                  placeholder={f.placeholder}
                  title={value[f.key] ?? undefined}
                  value={value[f.key] ?? ''}
                  onChange={(e) => onChange({ [f.key]: e.target.value.toUpperCase() || undefined })}
                />
              )}
            </div>
          ))}
        </div>
      </fieldset>
    ))}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Scan modal                                                                  */
/* -------------------------------------------------------------------------- */

export interface RcScanOutcome {
  registrationNumber?: string;
  make?: string;
  model?: string;
  machineType?: MachineType;
  details: RcDetails;
  files: File[];
}

interface ReviewForm {
  registrationNumber: string;
  make: string;
  model: string;
  machineType: MachineType | '';
  details: RcDetails;
}

const toReview = (p: ParsedRc): ReviewForm => {
  const { registrationNumber, make, model, machineType, ...details } = p;
  return {
    registrationNumber: registrationNumber ?? '',
    make: make ?? '',
    model: model ?? '',
    machineType: machineType ?? '',
    details,
  };
};

interface ModalProps {
  onClose: () => void;
  onApply: (outcome: RcScanOutcome) => void;
}

export const RcScanModal: React.FC<ModalProps> = ({ onClose, onApply }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<'select' | 'scanning' | 'review'>('select');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [lowConfidence, setLowConfidence] = useState(false);
  const [foundCount, setFoundCount] = useState(0);
  const [manual, setManual] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [review, setReview] = useState<ReviewForm>(toReview({}));
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !(isPdf(f) || f.type.startsWith('image/')));
    if (bad) {
      setError(`"${bad.name}" is not a PDF or photo.`);
      return;
    }
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) {
      setError(`"${big.name}" is over 10 MB. Please use a smaller file.`);
      return;
    }
    setError('');
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
  };

  const enterManually = () => {
    setManual(true);
    setError('');
    setFoundCount(0);
    setLowConfidence(false);
    setReview(toReview({}));
    setPhase('review');
  };

  const runScan = async () => {
    if (!files.length) {
      setError('Add the RC as a PDF or photo first.');
      return;
    }
    setError('');
    setManual(false);
    setPhase('scanning');
    setProgress(0);
    setStatus('Preparing…');
    try {
      const result = await scanRcDocuments(files, (p) => {
        setProgress(p.progress);
        if (p.status) setStatus(p.status);
      });
      setLowConfidence(result.confidence < 60);
      setFoundCount(Object.values(result.parsed).filter((v) => v !== undefined && v !== '').length);
      setReview(toReview({ ...result.parsed, scannedAt: new Date().toISOString() }));
      setPhase('review');
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not read the document (${e.message}). You can still enter the details by hand.`
          : 'Could not read the document. You can still enter the details by hand.',
      );
      setPhase('select');
    }
  };

  const apply = () =>
    onApply({
      registrationNumber: review.registrationNumber.trim() || undefined,
      make: review.make.trim() || undefined,
      model: review.model.trim() || undefined,
      machineType: review.machineType || undefined,
      details: Object.fromEntries(
        Object.entries(review.details).filter(([, v]) => v !== undefined && v !== ''),
      ) as RcDetails,
      files,
    });

  const patchDetails = (patch: Partial<RcDetails>) =>
    setReview((r) => ({ ...r, details: { ...r.details, ...patch } }));

  return (
    <div className="modal-overlay">
      <div className="modal-panel modal-panel-wide text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <span className="section-icon"><ScanLine className="h-4 w-4" /></span>
            <div>
              <h3 className="modal-title">Scan registration certificate</h3>
              <p className="text-[11px] text-ink-500">
                Upload the machine's RC and the asset details fill in automatically.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4 sm:max-h-[72vh]">
          {error && (
            <div className="alert-banner" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs">{error}</span>
            </div>
          )}

          <Stepper current={phase === 'review' ? 1 : 0} />

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
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />

              {phase === 'scanning' ? (
                <div role="status" className="rounded-xl border border-line bg-surface-muted p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-logo-50 text-logo-700 ring-1 ring-logo-100">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-ink-800">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-logo-700">
                          {Math.round(progress * 100)}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        Reading {files.length} file{files.length > 1 ? 's' : ''}. The first scan downloads the reading engine (a few MB).
                      </p>
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
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                  }}
                  className={`group flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-500 ${
                    dragging
                      ? 'border-logo-500 bg-logo-50'
                      : 'border-line-strong bg-surface-muted/60 hover:border-logo-400 hover:bg-logo-50/50'
                  }`}
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 transition-colors ${
                    dragging ? 'bg-logo-600 text-white ring-logo-600' : 'bg-surface text-logo-700 ring-line group-hover:ring-logo-200'
                  }`}>
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      {dragging ? 'Drop to add the RC' : (
                        <>Drop the RC here, or <span className="text-logo-700 underline decoration-logo-300 underline-offset-2">browse</span></>
                      )}
                    </span>
                    <span className="block text-xs text-ink-500">
                      A two-page PDF from the RTO, or photos of the front and back of the card
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-center gap-1.5">
                    {['PDF', 'JPG', 'PNG'].map((t) => (
                      <span key={t} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-600">
                        {t}
                      </span>
                    ))}
                    <span className="text-[11px] text-ink-400">· up to {MAX_FILES} files, 10 MB each</span>
                  </span>
                </button>
              )}

              {files.length > 0 && (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        isPdf(f) ? 'bg-danger-50 text-danger-700' : 'bg-logo-50 text-logo-700'
                      }`}>
                        {isPdf(f) ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink-800" title={f.name}>{f.name}</span>
                        <span className="block text-[11px] text-ink-500">
                          {isPdf(f) ? 'PDF document' : 'Photo'} · {formatSize(f.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={phase === 'scanning'}
                        onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                        className="icon-btn shrink-0"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {phase === 'select' && (
                <div className="rounded-xl border border-line p-3.5">
                  <span className="stat-label block">Filled automatically from the RC</span>
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {READ_FIELDS.map((f) => (
                      <li key={f} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-medium text-ink-700">
                        <Check className="h-3 w-3 text-success-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-[11px] text-ink-500">
                    You check every value before it fills the asset form. The RC file is stored with the machine.
                  </p>
                </div>
              )}
            </>
          )}

          {phase === 'review' && (
            <>
              {manual ? (
                <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted p-3 text-ink-700">
                  <ScanLine className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-xs">Type the RC details below.</span>
                </div>
              ) : (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-3 ${
                    foundCount === 0 || lowConfidence
                      ? 'border-warning-600/40 bg-warning-50 text-warning-800'
                      : 'border-success-600/30 bg-success-50 text-success-800'
                  }`}
                >
                  {foundCount === 0 || lowConfidence ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="text-xs">
                    {foundCount === 0
                      ? 'Nothing could be read. Try a sharper scan, or type the details below.'
                      : `${foundCount} fields read from the RC. ${
                          lowConfidence ? 'The scan was hard to read — ' : ''
                        }Check them against the card, especially the chassis and engine numbers (O/0, S/5 and J/U are easy to confuse).`}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="form-label">Registration no.</label>
                  <input className="form-input font-semibold" value={review.registrationNumber}
                    onChange={(e) => setReview({ ...review, registrationNumber: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Make</label>
                  <input className="form-input" value={review.make}
                    onChange={(e) => setReview({ ...review, make: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Model</label>
                  <input className="form-input" value={review.model}
                    onChange={(e) => setReview({ ...review, model: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Crane type</label>
                  <select className="form-input" value={review.machineType}
                    onChange={(e) => setReview({ ...review, machineType: e.target.value as MachineType | '' })}>
                    <option value="">Keep current</option>
                    {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <RcDetailsFields value={review.details} onChange={patchDetails} />

              <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
                <FileText className="h-3.5 w-3.5" />
                {files.length
                  ? `${files.length} file${files.length > 1 ? 's' : ''} will be stored with the machine record.`
                  : 'No file added. The details are saved without one.'}
              </p>
            </>
          )}
        </div>

        <div className="modal-footer flex-wrap">
          <span className="mr-auto flex items-center gap-1.5 text-[11px] text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-success-600" />
            Read on this device — never sent to an OCR service
          </span>
          {phase === 'review' ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('select')}>
                <RotateCcw className="h-4 w-4" /> {manual ? 'Back to upload' : 'Rescan'}
              </button>
              <button type="button" className="btn btn-primary" onClick={apply}>
                <CheckCircle2 className="h-4 w-4" /> Use these details
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={phase === 'scanning'}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={enterManually} disabled={phase === 'scanning'}>
                Enter manually
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={runScan}
                disabled={phase === 'scanning' || !files.length}
              >
                <ScanLine className="h-4 w-4" />
                {phase === 'scanning' ? 'Reading…' : 'Read RC'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
