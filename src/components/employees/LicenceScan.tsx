import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScanLine,
  X,
  Upload,
  ImageIcon,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { LicenceExtras } from '../../types';
import {
  ParsedLicence,
  VEHICLE_CLASS_CODES,
  mergeParsed,
  scanLicenceImage,
} from '../../utils/licenceOcr';

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMMON_CLASSES = VEHICLE_CLASS_CODES.filter((c) => !['MC 50CC', 'ROADROLLER', 'ADPVEH', 'TRCTR'].includes(c));

/* -------------------------------------------------------------------------- */
/* Manual / reviewed licence fields                                            */
/* -------------------------------------------------------------------------- */

interface FieldsProps {
  value: LicenceExtras;
  onChange: (patch: Partial<LicenceExtras>) => void;
}

/** The extra licence details, editable by hand (also used to correct a scan). */
export const LicenceDetailsFields: React.FC<FieldsProps> = ({ value, onChange }) => {
  const classes = value.licenseVehicleClasses ?? [];
  const toggleClass = (code: string) =>
    onChange({
      licenseVehicleClasses: classes.includes(code) ? classes.filter((c) => c !== code) : [...classes, code],
    });

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <span className="stat-label block">Driving licence details</span>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="form-label">Son / Daughter / Wife of:</label>
          <input
            className="form-input"
            value={value.guardianName ?? ''}
            onChange={(e) => onChange({ guardianName: e.target.value })}
            placeholder="Father / spouse name"
          />
        </div>
        <div>
          <label className="form-label">Blood group:</label>
          <select
            className="form-input"
            value={value.bloodGroup ?? ''}
            onChange={(e) => onChange({ bloodGroup: e.target.value })}
          >
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>{g || 'Not set'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Organ donor:</label>
          <select
            className="form-input"
            value={value.organDonor === undefined ? '' : value.organDonor ? 'Y' : 'N'}
            onChange={(e) =>
              onChange({ organDonor: e.target.value === '' ? undefined : e.target.value === 'Y' })
            }
          >
            <option value="">Not set</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label className="form-label">Date of first issue:</label>
          <input type="date" className="form-input" value={value.licenseFirstIssueDate ?? ''}
            onChange={(e) => onChange({ licenseFirstIssueDate: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Current issue date:</label>
          <input type="date" className="form-input" value={value.licenseIssueDate ?? ''}
            onChange={(e) => onChange({ licenseIssueDate: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Valid till (non-transport):</label>
          <input type="date" className="form-input" value={value.licenseValidNt ?? ''}
            onChange={(e) => onChange({ licenseValidNt: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Valid till (transport):</label>
          <input type="date" className="form-input font-bold" value={value.licenseValidTr ?? ''}
            onChange={(e) => onChange({ licenseValidTr: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="form-label">Issued by (state):</label>
          <input className="form-input" value={value.licenseIssuingState ?? ''}
            onChange={(e) => onChange({ licenseIssuingState: e.target.value })} placeholder="e.g. Uttar Pradesh" />
        </div>
        <div>
          <label className="form-label">Licensing authority (RTO):</label>
          <input className="form-input" value={value.licenseIssuingAuthority ?? ''}
            onChange={(e) => onChange({ licenseIssuingAuthority: e.target.value })} placeholder="e.g. MAHARAJGANJ" />
        </div>
      </div>

      <div>
        <span className="form-label">Vehicle classes:</span>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_CLASSES.map((code) => {
            const active = classes.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={active}
                onClick={() => toggleClass(code)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'border-logo-700 bg-logo-700 text-white'
                    : 'border-line bg-surface text-ink-600 hover:bg-surface-muted'
                }`}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Scan modal                                                                  */
/* -------------------------------------------------------------------------- */

export interface ScanOutcome {
  parsed: ParsedLicence;
  files: { front?: File; back?: File };
}

interface ReviewForm {
  licenceNumber: string;
  name: string;
  dateOfBirth: string;
  address: string;
  extras: LicenceExtras;
}

const toReview = (p: ParsedLicence): ReviewForm => ({
  licenceNumber: p.licenceNumber ?? '',
  name: p.name ?? '',
  dateOfBirth: p.dateOfBirth ?? '',
  address: p.address ?? '',
  extras: {
    guardianName: p.guardianName,
    bloodGroup: p.bloodGroup,
    licenseIssueDate: p.issueDate,
    licenseValidNt: p.validNt,
    licenseValidTr: p.validTr,
    licenseFirstIssueDate: p.firstIssueDate,
    licenseIssuingState: p.issuingState,
    licenseIssuingAuthority: p.issuingAuthority,
    licenseVehicleClasses: p.vehicleClasses ?? [],
    organDonor: p.organDonor,
  },
});

const fromReview = (r: ReviewForm): ParsedLicence => ({
  licenceNumber: r.licenceNumber.trim() || undefined,
  name: r.name.trim() || undefined,
  dateOfBirth: r.dateOfBirth || undefined,
  address: r.address.trim() || undefined,
  guardianName: r.extras.guardianName?.trim() || undefined,
  bloodGroup: r.extras.bloodGroup || undefined,
  issueDate: r.extras.licenseIssueDate || undefined,
  validNt: r.extras.licenseValidNt || undefined,
  validTr: r.extras.licenseValidTr || undefined,
  firstIssueDate: r.extras.licenseFirstIssueDate || undefined,
  issuingState: r.extras.licenseIssuingState?.trim() || undefined,
  issuingAuthority: r.extras.licenseIssuingAuthority?.trim() || undefined,
  vehicleClasses: r.extras.licenseVehicleClasses ?? [],
  organDonor: r.extras.organDonor,
});

type Side = 'front' | 'back';

interface ModalProps {
  onClose: () => void;
  onApply: (outcome: ScanOutcome) => void;
}

export const LicenceScanModal: React.FC<ModalProps> = ({ onClose, onApply }) => {
  const [files, setFiles] = useState<{ front?: File; back?: File }>({});
  const [phase, setPhase] = useState<'select' | 'scanning' | 'review'>('select');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [lowConfidence, setLowConfidence] = useState(false);
  const [review, setReview] = useState<ReviewForm>(toReview({}));
  const [foundCount, setFoundCount] = useState(0);
  const [manual, setManual] = useState(false);
  const frontInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => ({
      front: files.front ? URL.createObjectURL(files.front) : '',
      back: files.back ? URL.createObjectURL(files.back) : '',
    }),
    [files.front, files.back],
  );
  useEffect(
    () => () => {
      if (previews.front) URL.revokeObjectURL(previews.front);
      if (previews.back) URL.revokeObjectURL(previews.back);
    },
    [previews],
  );

  const pick = (side: Side, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo (JPG or PNG).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('That photo is over 10 MB. Please use a smaller one.');
      return;
    }
    setError('');
    setFiles((prev) => ({ ...prev, [side]: file }));
  };

  /** Skip the photo and type everything by hand. */
  const enterManually = () => {
    setManual(true);
    setError('');
    setFoundCount(0);
    setLowConfidence(false);
    setReview(toReview({}));
    setPhase('review');
  };

  const runScan = async () => {
    if (!files.front && !files.back) {
      setError('Add at least one photo of the licence.');
      return;
    }
    setError('');
    setManual(false);
    setPhase('scanning');
    try {
      let merged: ParsedLicence = {};
      let worst = 100;
      const order: Side[] = ['front', 'back'];
      for (const side of order) {
        const file = files[side];
        if (!file) continue;
        const label = side === 'front' ? 'front side' : 'back side';
        setStatus(`Reading ${label}…`);
        setProgress(0);
        const result = await scanLicenceImage(file, (p) => {
          setProgress(p.progress);
          if (p.status) setStatus(`Reading ${label}… ${p.status}`);
        });
        worst = Math.min(worst, result.confidence);
        // Front is the main source; back fills gaps (classes, authority).
        merged = side === 'front' ? mergeParsed(result.parsed, merged) : mergeParsed(merged, result.parsed);
      }
      setLowConfidence(worst < 60);
      setFoundCount(Object.values(merged).filter((v) => (Array.isArray(v) ? v.length : v !== undefined)).length);
      setReview(toReview(merged));
      setPhase('review');
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not read the photo (${e.message}). You can still enter the details by hand.`
          : 'Could not read the photo. You can still enter the details by hand.',
      );
      setPhase('select');
    }
  };

  const dropzone = (side: Side, title: string, hint: string, ref: React.RefObject<HTMLInputElement | null>) => (
    <div>
      <span className="form-label">{title}</span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => pick(side, e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex aspect-[1.6] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-surface-muted transition-colors hover:border-logo-700"
      >
        {previews[side] ? (
          <img src={previews[side]} alt={`${title} preview`} className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-3 text-center text-ink-500">
            <ImageIcon className="h-6 w-6" />
            <span className="text-xs font-semibold text-ink-700">Tap to add photo</span>
            <span className="text-[11px]">{hint}</span>
          </span>
        )}
      </button>
      {files[side] && (
        <button
          type="button"
          onClick={() => setFiles((p) => ({ ...p, [side]: undefined }))}
          className="mt-1 text-[11px] font-semibold text-ink-500 underline hover:text-danger-700"
        >
          Remove
        </button>
      )}
    </div>
  );

  const patchExtras = (patch: Partial<LicenceExtras>) =>
    setReview((r) => ({ ...r, extras: { ...r.extras, ...patch } }));

  return (
    <div className="modal-overlay">
      <div className="modal-panel modal-panel-wide text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <span className="section-icon"><ScanLine className="h-4 w-4" /></span>
            <div>
              <h3 className="modal-title">Scan driving licence</h3>
              <p className="text-[11px] text-ink-500">
                Photos are read on this device and are not sent to any OCR service.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body max-h-[72vh] space-y-4 overflow-y-auto">
          {error && (
            <div className="alert-banner" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs">{error}</span>
            </div>
          )}

          {phase !== 'review' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {dropzone('front', 'Front of licence', 'Name, number, dates, address', frontInput)}
                {dropzone('back', 'Back of licence (optional)', 'Vehicle classes, authority', backInput)}
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-ink-500">
                <li>Lay the card flat in good light; sideways photos are straightened automatically.</li>
                <li>The front side gives the most details. You review and correct everything before saving.</li>
                <li>No photo or hard to read? Use <strong>Enter manually</strong> and type the details yourself.</li>
              </ul>
              {phase === 'scanning' && (
                <div role="status" className="space-y-1.5 rounded-lg border border-line bg-surface-muted p-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-ink-700">
                    <span>{status}</span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                  <p className="text-[11px] text-ink-500">The first scan downloads the reading engine (a few MB).</p>
                </div>
              )}
            </>
          )}

          {phase === 'review' && (
            <>
              {manual ? (
                <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted p-3 text-ink-700">
                  <ScanLine className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-xs">
                    Type the licence details below. You can attach the licence photos afterwards.
                  </span>
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
                    ? 'Nothing could be read from the photo. Try a clearer, flatter photo, or type the details below.'
                    : lowConfidence
                      ? 'The photo was hard to read, so some fields may be wrong. Check every field against the card.'
                      : 'Details read from the card. Please check them against the card before saving.'}
                </span>
              </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="form-label">Licence number:</label>
                  <input className="form-input font-semibold" value={review.licenceNumber}
                    onChange={(e) => setReview({ ...review, licenceNumber: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Holder name:</label>
                  <input className="form-input" value={review.name}
                    onChange={(e) => setReview({ ...review, name: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Date of birth:</label>
                  <input type="date" className="form-input" value={review.dateOfBirth}
                    onChange={(e) => setReview({ ...review, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Address:</label>
                  <textarea rows={2} className="form-input" value={review.address}
                    onChange={(e) => setReview({ ...review, address: e.target.value })} />
                </div>
              </div>

              <LicenceDetailsFields value={review.extras} onChange={patchExtras} />

              <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                {files.front || files.back
                  ? 'The photos are stored with the employee record so they can be checked later.'
                  : 'No photo added. The details are saved without one.'}
              </p>
            </>
          )}
        </div>

        <div className="modal-footer">
          {phase === 'review' ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('select')}>
                <RotateCcw className="h-4 w-4" /> {manual ? 'Back to photos' : 'Rescan'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onApply({ parsed: fromReview(review), files })}
              >
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
                disabled={phase === 'scanning' || (!files.front && !files.back)}
              >
                <Upload className="h-4 w-4" />
                {phase === 'scanning' ? 'Reading…' : 'Read licence'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
