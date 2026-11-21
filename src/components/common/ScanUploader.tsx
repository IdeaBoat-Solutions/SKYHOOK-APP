import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { isPdf } from '../../utils/ocrEngine';

const MAX_BYTES = 10 * 1024 * 1024;

const formatSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`;

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  /** Most files that can be added. */
  max: number;
  /** Shown when a file is rejected (wrong type, too big). */
  onError?: (message: string) => void;
  /** Headline inside the drop area, e.g. "Drop the policy here". */
  title: string;
  hint?: string;
  /** Allow PDFs as well as photos. */
  pdf?: boolean;
  disabled?: boolean;
}

/**
 * One upload area for a scan: add photos (or a PDF) up to a limit, see a thumbnail of
 * each, remove any of them. Nothing is read until the caller's own "Read" button is pressed.
 */
export const ScanUploader: React.FC<Props> = ({ files, onChange, max, onError, title, hint, pdf = true, disabled }) => {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const full = files.length >= max;

  const add = (list: FileList | null) => {
    if (!list?.length || disabled) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !(f.type.startsWith('image/') || (pdf && isPdf(f))));
    if (bad) return onError?.(`"${bad.name}" is not a ${pdf ? 'PDF or ' : ''}photo.`);
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) return onError?.(`"${big.name}" is over 10 MB. Please use a smaller file.`);
    if (files.length + picked.length > max) onError?.(`You can add up to ${max} files. The extra ones were left out.`);
    else onError?.('');
    onChange([...files, ...picked].slice(0, max));
  };

  // Thumbnails (revoked when the list changes).
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
    [files],
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        multiple
        accept={pdf ? 'application/pdf,.pdf,image/*' : 'image/*'}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        disabled={disabled || full}
        onClick={() => input.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); if (!full) setDragging(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
        className={`flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-500 disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging ? 'border-logo-500 bg-logo-50' : 'border-line-strong bg-surface-muted/60 hover:border-logo-400 hover:bg-logo-50/50'
        }`}
      >
        <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dragging ? 'bg-logo-600 text-white ring-logo-600' : 'bg-surface text-logo-700 ring-line'}`}>
          <Upload className="h-5 w-5" />
        </span>
        <span className="space-y-1">
          <span className="block text-sm font-semibold text-ink-900">
            {full ? 'File limit reached' : dragging ? 'Drop to add' : <>{title} <span className="text-logo-700 underline decoration-logo-300 underline-offset-2">browse</span></>}
          </span>
          <span className="block text-xs text-ink-500">{hint ?? 'Add all the pages or both sides here, then press the Read button.'}</span>
        </span>
        <span className="flex flex-wrap items-center justify-center gap-1.5">
          {(pdf ? ['PDF', 'JPG', 'PNG'] : ['JPG', 'PNG']).map((t) => (
            <span key={t} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-600">{t}</span>
          ))}
          <span className="text-[11px] text-ink-400">· {files.length} of {max} added · 10 MB each</span>
        </span>
      </button>

      {files.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
              <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted ring-1 ring-line">
                {previews[i] ? (
                  <img src={previews[i]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-5 w-5 text-danger-700" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink-800" title={f.name}>{f.name}</span>
                <span className="block text-[11px] text-ink-500">{isPdf(f) ? 'PDF document' : 'Photo'} · {formatSize(f.size)}</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="icon-btn shrink-0"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
