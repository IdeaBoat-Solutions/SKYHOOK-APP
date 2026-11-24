import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  ReceiptIndianRupee,
  Search,
  ShieldCheck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import type { ExtractedDocument, ExtractedDocumentType } from '../../types';

const TYPE_ORDER: ExtractedDocumentType[] = [
  'loan_sanction',
  'fitness_certificate',
  'insurance_quote',
  'tax_receipt',
];

const TYPE_META: Record<ExtractedDocumentType, {
  label: string;
  icon: LucideIcon;
  badge: string;
}> = {
  loan_sanction: { label: 'Loan sanction', icon: Landmark, badge: 'badge-brand' },
  fitness_certificate: { label: 'Fitness certificate', icon: ShieldCheck, badge: 'badge-success' },
  insurance_quote: { label: 'Insurance quote', icon: ReceiptIndianRupee, badge: 'badge-warning' },
  tax_receipt: { label: 'Tax receipt', icon: Wallet, badge: 'badge-neutral' },
};

const humanize = (key: string): string => key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const money = (n: number): string => `₹${n.toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
})}`;

const MONEY_KEY = /(amount|premium|idv|cost|emi|interest|principal|balance|instal|tax|penalty|rebate|surcharge|total|payment|reimbursement|charges|si)/i;

function scalar(value: unknown, name = ''): React.ReactNode {
  if (value == null || value === '') return <span className="text-ink-400">-</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const n = Number(value);
    return MONEY_KEY.test(name) ? money(n) : n.toLocaleString('en-IN');
  }
  const text = String(value);
  // Dates are stored as ISO strings in the extracted payloads.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return <>{text.length > 10 ? `${formatDateDDMMYYYY(text)} ${text.slice(11, 16)}` : formatDateDDMMYYYY(text)}</>;
  }
  return <>{text}</>;
}

/** Recursive renderer: scalars, nested objects and arrays of objects (tables). */
const DetailFields: React.FC<{ value: unknown; name?: string; depth?: number }> = ({
  value,
  name = '',
  depth = 0,
}) => {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-ink-400">-</span>;
    if (value[0] !== null && typeof value[0] === 'object') {
      const rows = value as Record<string, unknown>[];
      const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      return (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>{keys.map((k) => <th key={k} className="px-3 py-2 text-left">{humanize(k)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-700">
              {rows.map((row, i) => (
                <tr key={i} className="transition-colors">
                  {keys.map((k) => (
                    <td key={k} className="px-3 py-2 align-top text-sm">
                      <DetailFields value={row[k]} name={k} depth={depth + 1} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <>{value.map((v, i) => <React.Fragment key={i}>{scalar(v)}{i < value.length - 1 ? ', ' : ''}</React.Fragment>)}</>;
  }

  if (value !== null && typeof value === 'object') {
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{humanize(k)}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink-800">
              <DetailFields value={v} name={k} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <>{scalar(value, name)}</>;
};

export const ExtractedDocumentsView: React.FC = () => {
  const { extractedDocuments } = useSkyhook();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | ExtractedDocumentType>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const doc of extractedDocuments) out[doc.docType] = (out[doc.docType] ?? 0) + 1;
    return out;
  }, [extractedDocuments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return extractedDocuments.filter((doc) => {
      if (type !== 'all' && doc.docType !== type) return false;
      if (!q) return true;
      return [doc.title, doc.docType, doc.naturalKey, doc.entityName, doc.vehicleNumber, doc.sourceFile]
        .some((value) => (value ?? '').toLowerCase().includes(q));
    });
  }, [extractedDocuments, query, type]);

  const selected = filtered.find((doc) => doc.id === expanded);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Scanned documents</h2>
          <p className="text-sm text-ink-500">
            Structured data extracted from the scanned PDFs and stored in Supabase.
          </p>
        </div>
        <span className="badge badge-neutral">{extractedDocuments.length} record{extractedDocuments.length === 1 ? '' : 's'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TYPE_ORDER.map((key) => {
          const meta = TYPE_META[key];
          const Icon = meta.icon;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setType((t) => (t === key ? 'all' : key))}
              className={`card card-pad text-left transition-colors ${type === key ? 'ring-2 ring-brand-400' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="stat-label">{meta.label}</span>
                <Icon className="h-4 w-4 text-ink-400" />
              </div>
              <div className="stat-value mt-2">{counts[key] ?? 0}</div>
              <div className="mt-1 text-[11px] text-ink-400">Click to filter</div>
            </button>
          );
        })}
      </div>

      <div className="filter-bar">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="form-input w-full pl-9"
            placeholder="Search by reference, party, vehicle or file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="form-input min-w-48"
          value={type}
          onChange={(e) => setType(e.target.value as 'all' | ExtractedDocumentType)}
        >
          <option value="all">All document types</option>
          {TYPE_ORDER.map((key) => (
            <option key={key} value={key}>{TYPE_META[key].label}</option>
          ))}
        </select>
        {(type !== 'all' || query) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setType('all'); setQuery(''); }}
          >
            <X className="h-4 w-4" /> Clear
          </button>
        )}
      </div>

      <div className="table-card">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <FileText className="mx-auto h-8 w-8 text-ink-300" />
            <p className="mt-2 font-semibold text-ink-700">No documents found</p>
            <p className="mt-1 text-sm text-ink-500">
              Run the 0008 migration in Supabase, then reload the app to fetch the extracted data.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-3.5 py-3 text-left">Document</th>
                  <th className="px-3.5 py-3 text-left">Reference</th>
                  <th className="px-3.5 py-3 text-left">Party / vehicle</th>
                  <th className="px-3.5 py-3 text-left">Date</th>
                  <th className="px-3.5 py-3 text-right">Amount</th>
                  <th className="px-3.5 py-3 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-700">
                {filtered.map((doc) => {
                  const meta = TYPE_META[doc.docType] ?? TYPE_META.loan_sanction;
                  const Icon = meta.icon;
                  const isOpen = expanded === doc.id;
                  return (
                    <React.Fragment key={doc.id}>
                      <tr className={`transition-colors ${isOpen ? 'bg-surface-2' : ''}`}>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-ink-400" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-ink-900">{doc.title}</div>
                              <div className={`badge mt-1 ${meta.badge}`}>{meta.label}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3.5 py-3 font-mono text-xs text-ink-600">{doc.naturalKey}</td>
                        <td className="px-3.5 py-3">
                          <div className="font-medium text-ink-800">{doc.entityName || '-'}</div>
                          {doc.vehicleNumber && <div className="text-xs text-ink-500">{doc.vehicleNumber}</div>}
                        </td>
                        <td className="px-3.5 py-3 text-ink-600">
                          {doc.issueDate ? formatDateDDMMYYYY(doc.issueDate) : '-'}
                          {doc.expiryDate && (
                            <div className="text-xs text-ink-400">Exp. {formatDateDDMMYYYY(doc.expiryDate)}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          {doc.amount != null ? (
                            <>
                              <div className="font-semibold text-ink-900">{money(doc.amount)}</div>
                              {doc.amountLabel && <div className="text-[11px] text-ink-400">{doc.amountLabel}</div>}
                            </>
                          ) : <span className="text-ink-400">-</span>}
                        </td>
                        <td className="px-3.5 py-3 text-center">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setExpanded(isOpen ? null : doc.id)}
                            aria-label={isOpen ? 'Hide details' : 'Show details'}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {isOpen ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="px-3.5 pb-4 pt-0">
                            <div className="card card-pad border border-line">
                              <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
                                <div>
                                  <h3 className="font-bold text-ink-900">Extracted data</h3>
                                  <p className="mt-0.5 text-xs text-ink-500">
                                    Source: {doc.sourceFile}
                                    {doc.scannedAt && ` · Synced ${formatDateDDMMYYYY(doc.scannedAt)}`}
                                  </p>
                                </div>
                                <button type="button" className="icon-btn" onClick={() => setExpanded(null)} aria-label="Close details">
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <DetailFields value={doc.details} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
