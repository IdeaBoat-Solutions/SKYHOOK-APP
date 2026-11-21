import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';

/** yyyy-mm-dd -> dd/mm/yyyy ('' when empty). */
export const isoToDisplay = (iso?: string | null): string => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** dd/mm/yyyy (also dd-mm-yyyy, dd.mm.yyyy) -> yyyy-mm-dd, or null if it is not a real date. */
export const displayToIso = (text: string): string | null => {
  const m = text.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Auto-insert the slashes while typing: 21112026 -> 21/11/2026. */
const mask = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

type Base = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'>;

interface Props extends Base {
  /** ISO yyyy-mm-dd, or ''. */
  value: string;
  /** Called with an event-like object so existing `(e) => set(e.target.value)` handlers keep working. */
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
}

/**
 * Date field that always reads dd/mm/yyyy, whatever the browser or phone language is
 * (the browser's own date box shows mm/dd/yyyy in some locales). Type the date or tap the
 * calendar icon: the icon opens the device's native calendar, which is the easiest way to
 * pick a date on a phone. The value handed back is always ISO yyyy-mm-dd.
 */
export const DateInput: React.FC<Props> = ({ value, onChange, min, max, className = '', required, disabled, id, placeholder, ...rest }) => {
  const [text, setText] = useState(isoToDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Follow the value when it changes from outside (calendar, form reset, scan).
  useEffect(() => {
    setText((current) => (displayToIso(current) === value ? current : isoToDisplay(value)));
    setInvalid(false);
  }, [value]);

  const commit = (next: string) => {
    setText(next);
    if (next === '') {
      setInvalid(false);
      if (value !== '') onChange({ target: { value: '' } });
      return;
    }
    const iso = displayToIso(next);
    if (iso) {
      setInvalid(false);
      if (iso !== value) onChange({ target: { value: iso } });
    } else {
      setInvalid(next.length >= 10);
    }
  };

  const openPicker = () => {
    const el = picker.current;
    if (!el || disabled) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="relative">
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? 'dd/mm/yyyy'}
        maxLength={10}
        required={required}
        disabled={disabled}
        value={text}
        onChange={(e) => commit(mask(e.target.value))}
        onBlur={() => {
          // Leave the field in a consistent state: snap back to the last valid date.
          if (text !== '' && displayToIso(text) === null) {
            setText(isoToDisplay(value));
            setInvalid(false);
          }
        }}
        aria-invalid={invalid || undefined}
        className={`${className} pr-10 ${invalid ? '!border-danger-500' : ''}`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openPicker}
        aria-label="Open calendar"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 hover:text-ink-700 disabled:opacity-50"
      >
        <Calendar className="h-4 w-4" />
      </button>
      {/* Native calendar, used only as the picker; it never shows a date itself. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        onChange={(e) => {
          if (e.target.value) onChange({ target: { value: e.target.value } });
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </div>
  );
};
