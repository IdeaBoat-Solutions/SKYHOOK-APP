import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import type { DocumentRecord, RcDetails } from '../../types';
import { useSkyhook } from '../../data/apiStore';
import { formatDateDDMMYYYY } from '../../utils/calculations';

const ROWS: { key: keyof RcDetails; label: string; date?: boolean; suffix?: string }[] = [
  { key: 'chassisNumber', label: 'Chassis no.' },
  { key: 'engineNumber', label: 'Engine no.' },
  { key: 'registrationDate', label: 'Registered on', date: true },
  { key: 'registrationValidUpto', label: 'Registration valid till', date: true },
  { key: 'ownerName', label: 'Registered owner' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'ownerSerial', label: 'Owner serial' },
  { key: 'financier', label: 'Financier' },
  { key: 'vehicleClass', label: 'Vehicle class' },
  { key: 'makerName', label: 'Maker' },
  { key: 'bodyType', label: 'Body type' },
  { key: 'colour', label: 'Colour' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'emissionNorms', label: 'Emission norms' },
  { key: 'manufactureMonthYear', label: 'Mfg. month-year' },
  { key: 'cylinders', label: 'Cylinders' },
  { key: 'seatingCapacity', label: 'Seating' },
  { key: 'unladenWeightKg', label: 'Unladen weight', suffix: ' kg' },
  { key: 'cubicCapacityCc', label: 'Cubic capacity', suffix: ' cc' },
  { key: 'horsePower', label: 'Power (BHP/kW)' },
  { key: 'wheelBaseMm', label: 'Wheel base', suffix: ' mm' },
  { key: 'registrationAuthority', label: 'Registration authority' },
  { key: 'ownerAddress', label: 'Owner address' },
];

/** Read-only view of the RC details on the machine profile. */
export const RcDetailsSummary: React.FC<{ details?: RcDetails }> = ({ details }) => {
  const rows = ROWS.filter((r) => details?.[r.key] !== undefined && details?.[r.key] !== '');
  if (!details || !rows.length) {
    return (
      <p className="text-xs text-ink-500">
        No RC details yet. Edit the asset and use <strong>Scan RC</strong> to fill them from the registration certificate.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {rows.map((r) => {
        const raw = details[r.key];
        const value = r.date ? formatDateDDMMYYYY(String(raw)) : `${raw}${r.suffix ?? ''}`;
        return (
          <div key={r.key} className={`min-w-0 ${r.key === 'ownerAddress' ? 'col-span-2' : ''}`}>
            <dt className="stat-label block">{r.label}</dt>
            <dd className="mt-1 break-words text-xs font-semibold text-ink-800">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
};

/** Documents stored against a machine (RC scans etc.), with download. */
export const MachineDocumentsList: React.FC<{ machineId: string }> = ({ machineId }) => {
  const { listMachineDocuments, downloadDocument } = useSkyhook();
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDocs(null);
    setError('');
    listMachineDocuments(machineId)
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setError('Could not load documents.'));
    return () => {
      alive = false;
    };
    // Store functions are recreated on every provider render; refetch per machine only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  const open = async (doc: DocumentRecord) => {
    setBusy(doc.id);
    try {
      const blob = await downloadDocument(doc.fileUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(`Could not download ${doc.name}.`);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-xs text-danger-700">{error}</p>;
  if (!docs) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading documents…
      </p>
    );
  }
  if (!docs.length) return <p className="text-xs text-ink-500">No documents attached yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-ink-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink-800">{d.type}</div>
            <div className="truncate text-[11px] text-ink-500">
              {d.name}
              {d.uploadDate && ` · uploaded ${formatDateDDMMYYYY(d.uploadDate)}`}
              {d.expiryDate && ` · valid till ${formatDateDDMMYYYY(d.expiryDate)}`}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary !px-2 !py-1 text-[11px]"
            onClick={() => open(d)}
            disabled={busy === d.id}
            aria-label={`Download ${d.name}`}
          >
            {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
        </li>
      ))}
    </ul>
  );
};
