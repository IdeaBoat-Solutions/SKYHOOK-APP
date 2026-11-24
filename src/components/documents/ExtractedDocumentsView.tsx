import React, { useEffect, useMemo, useState } from 'react';
import {
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

const TYPE_META: Record<ExtractedDocumentType, { label: string; icon: LucideIcon; badge: string }> = {
  loan_sanction: { label: 'Loan sanction', icon: Landmark, badge: 'badge-brand' },
  fitness_certificate: { label: 'Fitness certificate', icon: ShieldCheck, badge: 'badge-success' },
  insurance_quote: { label: 'Insurance quote', icon: ReceiptIndianRupee, badge: 'badge-warning' },
  tax_receipt: { label: 'Tax receipt', icon: Wallet, badge: 'badge-neutral' },
};

const humanize = (key: string): string => key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const money = (n: number): string => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MONEY_KEY = /(amount|premium|idv|cost|emi|interest|principal|balance|instal|tax|penalty|rebate|surcharge|total|payment|reimbursement)/i;
const PERCENT_KEY = /(pct|ratePercent)/i;

function renderScalar(name: string, value: unknown): React.ReactNode {
  if (value == null || value === '') return <span className="text-ink-400">-</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const n = Number(value);
    if (MONEY_KEY.test(name)) return <span className="font-medium text-ink-900">{money(n)}</span>;
    if (PERCENT_KEY.test(name)) return `${n}%`;
    return n.toLocaleString('en-IN');
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = formatDateDDMMYYYY(text);
    return text.length > 10 ? `${date} · ${text.slice(11, 16)}` : date;
  }
  return <span className="break-words">{text}</span>;
}

/* -------------------------------------------------------------------------- */
/* Reusable structured display pieces                                          */
/* -------------------------------------------------------------------------- */

type Field = { label: string; value: unknown };

/** Label on the left, value on the right - no narrow multi-column cells. */
const FieldRows: React.FC<{ fields: Field[]; compact?: boolean; nested?: boolean }> = ({
  fields,
  compact = false,
  nested = false,
}) => (
  <dl className={`divide-y divide-line ${compact ? '' : 'rounded-lg border border-line px-3'}`}>
    {fields.map(({ label, value }) => (
      <div
        key={label}
        className={`grid grid-cols-1 gap-0.5 py-2 ${nested ? '' : 'md:grid-cols-[minmax(140px,220px)_minmax(0,1fr)] md:gap-4'}`}
      >
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
        <dd className="min-w-0 text-sm leading-relaxed text-ink-800">
          <DetailValue name={label} value={value} />
        </dd>
      </div>
    ))}
  </dl>
);

const DataTable: React.FC<{ rows: Record<string, unknown>[]; order?: string[] }> = ({ rows, order }) => {
  if (!rows.length) return <p className="text-sm text-ink-400">No rows recorded.</p>;
  const found = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const keys = order
    ? [...order.filter((key) => found.includes(key)), ...found.filter((key) => !order.includes(key))]
    : found;
  return (
    <div className="table-wrap max-h-80 overflow-y-auto rounded-lg border border-line">
      <table className="data-table">
        <thead className="sticky top-0 z-10">
          <tr>{keys.map((key) => <th key={key} className="whitespace-nowrap px-3 py-2 text-left">{humanize(key)}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line text-ink-700">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-muted">
              {keys.map((key) => (
                <td key={key} className="whitespace-nowrap px-3 py-2 text-sm">
                  <DetailValue name={key} value={row[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Recursively renders nested values while keeping labels aligned. */
const DetailValue: React.FC<{ name: string; value: unknown; depth?: number }> = ({ name, value, depth = 0 }) => {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-ink-400">-</span>;
    if (value[0] !== null && typeof value[0] === 'object') {
      return <DataTable rows={value as Record<string, unknown>[]} />;
    }
    return <>{value.map((v, i) => <React.Fragment key={i}>{renderScalar(name, v)}{i < value.length - 1 ? ', ' : ''}</React.Fragment>)}</>;
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= 2) return <span className="text-sm text-ink-600">{Object.keys(value as object).length} fields</span>;
    return (
      <div className={depth > 0 ? 'ml-2 border-l-2 border-line pl-3' : ''}>
        <FieldRows
          compact
          nested
          fields={Object.entries(value as Record<string, unknown>).map(([key, val]) => ({ label: humanize(key), value: val }))}
        />
      </div>
    );
  }
  return <>{renderScalar(name, value)}</>;
};

const Section: React.FC<{ title: string; children: React.ReactNode; description?: string }> = ({
  title,
  children,
  description,
}) => (
  <section>
    <h3 className="mb-1 text-sm font-bold text-ink-900">{title}</h3>
    {description && <p className="mb-3 text-xs text-ink-500">{description}</p>}
    {!description && <div className="mb-3 h-px bg-line" />}
    {children}
  </section>
);

const rowsOf = (obj: unknown): Field[] => Object.entries((obj ?? {}) as Record<string, unknown>)
  .map(([key, value]) => ({ label: humanize(key), value }));

/* -------------------------------------------------------------------------- */
/* Document-specific layouts                                                    */
/* -------------------------------------------------------------------------- */

const DocumentBody: React.FC<{ doc: ExtractedDocument }> = ({ doc }) => {
  const d = doc.details as any;

  switch (doc.docType) {
    case 'loan_sanction':
      return (
        <div className="space-y-7">
          <Section title="Loan overview">
            <FieldRows fields={rowsOf({
              bank: d.bank,
              document: d.document,
              applicationNo: d.applicationNo,
              kfsGenerationDate: d.kfsGenerationDate,
              product: d.product,
              vehicleType: d.vehicleType,
              productSegment: d.productSegment,
              blCode: d.blCode,
              blName: d.blName,
              disbursalSchedule: d.financials?.disbursalSchedule,
            })} />
          </Section>

          <Section title="Borrower & co-borrower">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-line p-3">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Primary customer</h4>
                <FieldRows compact fields={rowsOf(d.customer)} />
              </div>
              <div className="rounded-lg border border-line p-3">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Co-applicant / guarantor</h4>
                <FieldRows compact fields={rowsOf(d.coApplicant)} />
              </div>
            </div>
          </Section>

          <Section title="Financial terms" description="All amounts in Indian Rupees unless stated otherwise.">
            <FieldRows fields={rowsOf(d.financials)} />
          </Section>

          <Section title="Schedule of charges" description="Non-refundable fees and charges, including GST where applicable.">
            <DataTable rows={(d.charges ?? []) as Record<string, unknown>[]} order={['head', 'amount']} />
          </Section>

          <Section title={`Repayment schedule (${(d.amortization ?? []).length} installments)`} description="Tentative amortization as per the sanction letter. Scroll to see all rows.">
            <DataTable
              rows={(d.amortization ?? []) as Record<string, unknown>[]}
              order={['no', 'date', 'installment', 'interest', 'principal', 'balance']}
            />
          </Section>

          <Section title="Consent trail">
            <FieldRows fields={rowsOf(d.consent)} />
          </Section>
        </div>
      );

    case 'fitness_certificate':
      return (
        <div className="space-y-7">
          <Section title="Certificate">
            <FieldRows fields={rowsOf({
              department: d.department,
              form: d.form,
              vehicleNo: d.vehicleNo,
              vehicleClass: d.vehicleClass,
              registrationNo: d.registrationNo,
              applicationNo: d.applicationNo,
              note: d.note,
            })} />
          </Section>
          <Section title="Vehicle details">
            <FieldRows fields={rowsOf({
              chassisNo: d.chassisNo,
              engineNo: d.engineNo,
              seatingCapacity: d.seatingCapacity,
              typeOfBody: d.typeOfBody,
              manufacturingYear: d.manufacturingYear,
              categoryOfVehicle: d.categoryOfVehicle,
            })} />
          </Section>
          <Section title="Validity & inspection">
            <FieldRows fields={rowsOf({
              inspectedIssuedOn: d.inspectedIssuedOn,
              expiryDate: d.expiryDate,
              nextInspectionDue: d.nextInspectionDue,
              receiptNo: d.receiptNo,
              receiptDate: d.receiptDate,
              printedOn: d.printedOn,
              inspectedBy: d.inspectedBy,
              issuingAuthority: d.issuingAuthority,
            })} />
          </Section>
        </div>
      );

    case 'insurance_quote':
      return (
        <div className="space-y-7">
          <Section title="Quote & policy">
            <FieldRows fields={rowsOf({
              insurer: d.insurer,
              quoteNumber: d.quoteNumber,
              quoteGenerationDate: d.quoteGenerationDate,
              clientName: d.clientName,
              plan: d.plan,
              validity: d.validity,
            })} />
          </Section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Insured vehicle">
              <FieldRows fields={rowsOf(d.vehicle)} />
            </Section>
            <Section title="Producer">
              <FieldRows fields={rowsOf(d.producer)} />
            </Section>
          </div>
          <Section title="IDV (insured declared value)">
            <FieldRows fields={rowsOf(d.idv)} />
          </Section>
          <Section title="Premium breakup">
            <FieldRows fields={rowsOf(d.premium)} />
          </Section>
          <Section title="Add-on covers" description="Opted add-ons and their individual premiums.">
            <DataTable rows={(d.addOns ?? []) as Record<string, unknown>[]} order={['name', 'amount', 'note']} />
          </Section>
          <Section title="Liability cover details">
            <FieldRows fields={rowsOf({
              compulsoryPaCoverOwnerDriver: d.compulsoryPaCoverOwnerDriver,
              paidDriverImt17: d.paidDriverImt17,
              unnamedPassengersImt16: d.unnamedPassengersImt16,
              note: d.note,
            })} />
          </Section>
        </div>
      );

    case 'tax_receipt':
      return (
        <div className="space-y-7">
          <Section title="Receipt & payment">
            <FieldRows fields={rowsOf({
              department: d.department,
              authority: d.authority,
              applicationNo: d.applicationNo,
              receiptNo: d.receiptNo,
              paymentDate: d.paymentDate,
              transactionDate: d.transactionDate,
              receivedFrom: d.receivedFrom,
              period: d.period,
            })} />
          </Section>
          <Section title="Vehicle & payment reference">
            <FieldRows fields={rowsOf({
              vehicleNo: d.vehicleNo,
              vehicleClass: d.vehicleClass,
              chassisNo: d.chassisNo,
              bankReferenceNumber: d.bankReferenceNumber,
              grnNo: d.grnNo,
              transactionIdentificationNumber: d.transactionIdentificationNumber,
            })} />
          </Section>
          <Section title="Tax breakup">
            <FieldRows fields={rowsOf(d.breakdown)} />
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-surface-muted px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-500">Grand total</span>
              <span className="text-lg font-bold text-ink-900">{money(Number(d.grandTotal ?? 0))}</span>
              <span className="w-full text-xs text-ink-500">{d.grandTotalWords}</span>
            </div>
          </Section>
          <Section title="Note">
            <p className="text-sm leading-relaxed text-ink-600">{d.note}</p>
          </Section>
        </div>
      );

    default:
      return <FieldRows fields={rowsOf(doc.details)} />;
  }
};

/* -------------------------------------------------------------------------- */
/* List page                                                                    */
/* -------------------------------------------------------------------------- */

export const ExtractedDocumentsView: React.FC = () => {
  const { extractedDocuments } = useSkyhook();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | ExtractedDocumentType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selected = extractedDocuments.find((doc) => doc.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Scanned documents</h2>
          <p className="text-sm text-ink-500">
            Structured data extracted from the scanned PDFs and stored in Supabase.
          </p>
        </div>
        <span className="badge badge-neutral">{extractedDocuments.length} document{extractedDocuments.length === 1 ? '' : 's'}</span>
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
        <div className="relative min-w-48 flex-1">
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
          {TYPE_ORDER.map((key) => <option key={key} value={key}>{TYPE_META[key].label}</option>)}
        </select>
        {(type !== 'all' || query) && (
          <button type="button" className="btn btn-ghost" onClick={() => { setType('all'); setQuery(''); }}>
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
                  return (
                    <tr key={doc.id} className="transition-colors">
                      <td className="px-3.5 py-3">
                        <div className="flex items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-900">{doc.title}</div>
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
                        {doc.expiryDate && <div className="text-xs text-ink-400">Exp. {formatDateDDMMYYYY(doc.expiryDate)}</div>}
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
                        <button type="button" className="btn btn-secondary" onClick={() => setSelectedId(doc.id)}>
                          View <ChevronRight className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelectedId(null)}>
          <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="min-w-0">
                <div className="modal-title truncate">{selected.title}</div>
                <div className="mt-0.5 text-xs text-ink-500">
                  Source: {selected.sourceFile} · Reference: {selected.naturalKey}
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-6">
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['Type', TYPE_META[selected.docType]?.label ?? selected.docType],
                  ['Party', selected.entityName],
                  ['Vehicle', selected.vehicleNumber],
                  ['Issued', selected.issueDate ? formatDateDDMMYYYY(selected.issueDate) : undefined],
                  ['Expires', selected.expiryDate ? formatDateDDMMYYYY(selected.expiryDate) : undefined],
                  ['Amount', selected.amount != null ? money(selected.amount) : undefined],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-ink-800">{value || '-'}</div>
                  </div>
                ))}
              </div>

              <DocumentBody doc={selected} />

              <details className="rounded-lg border border-line">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-700">
                  Raw extracted fields (complete payload)
                </summary>
                <div className="border-t border-line px-4 py-3">
                  <FieldRows fields={rowsOf(selected.details)} />
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
