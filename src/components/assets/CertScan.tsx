import React, { useEffect, useState } from 'react';
import { ScanLine, X, AlertCircle, CheckCircle2, RotateCcw, ShieldCheck, FileText, Loader2 } from 'lucide-react';
import { CERT_LABELS, scanCertificateDocuments, sameRegistration, type CertKind, type ParsedCert } from '../../utils/certOcr';
import { warmUp } from '../../utils/ocrEngine';
import { ScanUploader } from '../common/ScanUploader';
import { DateInput } from '../common/DateInput';
import { AgeingBar } from '../common/Ageing';

export interface CertOutcome {
  number?: string;
  provider?: string;
  issueDate?: string;
  expiryDate?: string;
  files: File[];
}

interface Props {
  kind: CertKind;
  /** The machine's registration number, to warn when the certificate is for another vehicle. */
  machineRegistration?: string;
  onClose: () => void;
  onApply: (outcome: CertOutcome) => void;
}

/** Read an insurance policy, PUC or fitness certificate (photos or PDF) and hand back the reviewed values. */
export const CertScanModal: React.FC<Props> = ({ kind, machineRegistration, onClose, onApply }) => {
  const labels = CERT_LABELS[kind];
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<'select' | 'scanning' | 'review'>('select');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [lowConfidence, setLowConfidence] = useState(false);
  const [parsed, setParsed] = useState<ParsedCert>({});
  const [number, setNumber] = useState('');
  const [provider, setProvider] = useState('');
  const [issue, setIssue] = useState('');
  const [expiry, setExpiry] = useState('');

  // Start the reading engines now so they are ready by the time a file is chosen.
  useEffect(() => {
    warmUp();
  }, []);

  const runScan = async () => {
    setError('');
    setPhase('scanning');
    setProgress(0);
    setStatus('Preparing…');
    try {
      const r = await scanCertificateDocuments(kind, files, (p) => {
        setProgress(p.progress);
        if (p.status) setStatus(p.status.charAt(0).toUpperCase() + p.status.slice(1));
      });
      setParsed(r.parsed);
      setLowConfidence(r.confidence < 60);
      setNumber(r.parsed.number ?? '');
      setProvider(r.parsed.provider ?? '');
      setIssue(r.parsed.issueDate ?? '');
      setExpiry(r.parsed.expiryDate ?? '');
      setPhase('review');
    } catch (e) {
      setError(`Could not read the document (${e instanceof Error ? e.message : 'unknown error'}). You can type the details instead.`);
      setPhase('select');
    }
  };

  const manual = () => {
    setParsed({});
    setNumber('');
    setProvider('');
    setIssue('');
    setExpiry('');
    setLowConfidence(false);
    setPhase('review');
  };

  const found = [parsed.number, parsed.issueDate, parsed.expiryDate, parsed.provider].filter(Boolean).length;
  const wrongVehicle =
    parsed.registrationNumber && machineRegistration && !sameRegistration(parsed.registrationNumber, machineRegistration);

  return (
    <div className="modal-overlay">
      <div className="modal-panel modal-panel-wide text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <span className="section-icon"><ScanLine className="h-4 w-4" /></span>
            <div>
              <h3 className="modal-title">Scan {labels.title.toLowerCase()}</h3>
              <p className="text-[11px] text-ink-500">Upload it and the number and dates fill in for you to check.</p>
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
                      <p className="mt-0.5 text-[11px] text-ink-500">Reading {files.length} file{files.length > 1 ? 's' : ''} on this device.</p>
                    </div>
                  </div>
                  <div className="progress mt-4"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                </div>
              ) : null}
              <ScanUploader
                files={files}
                onChange={setFiles}
                max={3}
                onError={setError}
                disabled={phase === 'scanning'}
                title={`Add the ${labels.title.toLowerCase()}: photos or a PDF.`}
                hint="Add every page here, then press Read. You can remove any file with the X."
              />
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
                      : `${lowConfidence ? 'The scan was hard to read. ' : ''}Check the number and both dates against the document before using them.`}
                </span>
              </div>

              {wrongVehicle && (
                <div className="flex items-start gap-2 rounded-lg border border-warning-600/40 bg-warning-50 p-3 text-warning-800" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-xs">
                    This document shows vehicle <strong>{parsed.registrationNumber}</strong>, but this machine is <strong>{machineRegistration}</strong>. Check it is the right document.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="cert-number">{labels.number}</label>
                  <input id="cert-number" className="form-input font-mono font-semibold" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} />
                </div>
                {kind === 'insurance' && (
                  <div>
                    <label className="form-label" htmlFor="cert-provider">Insurance company</label>
                    <input id="cert-provider" className="form-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="form-label" htmlFor="cert-issue">{labels.issue}</label>
                  <DateInput id="cert-issue" className="form-input" value={issue} onChange={(e) => setIssue(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="cert-expiry">{labels.expiry}</label>
                  <DateInput id="cert-expiry" className="form-input font-semibold" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>
              </div>

              <AgeingBar issue={issue} expiry={expiry} />

              <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
                <FileText className="h-3.5 w-3.5" />
                {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} will be stored with the machine record.` : 'No file added.'}
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
                onClick={() => onApply({ number: number.trim() || undefined, provider: provider.trim() || undefined, issueDate: issue || undefined, expiryDate: expiry || undefined, files })}
              >
                <CheckCircle2 className="h-4 w-4" /> Use these details
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={phase === 'scanning'}>Cancel</button>
              <button type="button" className="btn btn-secondary" onClick={manual} disabled={phase === 'scanning'}>Enter manually</button>
              <button type="button" className="btn btn-primary" onClick={runScan} disabled={phase === 'scanning' || !files.length}>
                <ScanLine className="h-4 w-4" /> {phase === 'scanning' ? 'Reading…' : 'Read document'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
