/**
 * Machine certificate OCR: insurance policy, PUC and fitness certificate.
 *
 * document (PDF or photos) -> page images -> text (tesseract.js on this device)
 * -> number, provider, issue/start date, expiry date, registration number.
 *
 * These certificates are issued by hundreds of different companies and RTOs, so the
 * reader does not depend on a layout. It finds each value by its printed label
 * ("Policy No", "Valid upto", "Period of Insurance: From ... To ...") and falls back
 * to the earliest / latest date. A person always reviews the result before it is used.
 */

import { documentToImages, isPdf, recognizeImages, type ScanProgress } from './ocrEngine';
import { normaliseRegistrationNumber } from './rcOcr';

export type CertKind = 'insurance' | 'puc' | 'fitness';

export interface ParsedCert {
  /** Policy / certificate number. */
  number?: string;
  /** Insurer (insurance only). */
  provider?: string;
  /** Policy start / test / issue date, ISO yyyy-mm-dd. */
  issueDate?: string;
  /** Valid-till / expiry / next-due date, ISO yyyy-mm-dd. */
  expiryDate?: string;
  /** Vehicle registration number found on the certificate, e.g. GJ-38-S-1889. */
  registrationNumber?: string;
}

export const CERT_LABELS: Record<CertKind, { title: string; number: string; issue: string; expiry: string; doc: string }> = {
  insurance: { title: 'Insurance policy', number: 'Policy number', issue: 'Policy start date', expiry: 'Policy expiry date', doc: 'Insurance Policy' },
  puc: { title: 'PUC certificate', number: 'Certificate number', issue: 'Date of test', expiry: 'Valid till', doc: 'PUC Certificate' },
  fitness: { title: 'Fitness certificate', number: 'Certificate number', issue: 'Date of issue / test', expiry: 'Valid till / next due', doc: 'Fitness Certificate' },
};

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface FoundDate { iso: string; index: number; end: number }

/** Every date in the text: 12/11/2025, 12-11-25, 12.11.2025, 12-Nov-2025, 12 November 2025, 2025-11-12. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const push = (value: string | undefined, index: number, len: number) => {
    if (value) out.push({ iso: value, index, end: index + len });
  };
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})(?!\d)/g)) {
    push(iso(year(m[3]!), Number(m[2]), Number(m[1])), m.index ?? 0, m[0].length);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    push(iso(Number(m[1]), Number(m[2]), Number(m[3])), m.index ?? 0, m[0].length);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{4}|\d{2})(?!\d)/g)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) push(iso(year(m[3]!), month, Number(m[1])), m.index ?? 0, m[0].length);
  }
  // A date matched by two patterns (e.g. 12-Nov-2025) is kept once.
  return out
    .sort((a, b) => a.index - b.index)
    .filter((d, i, all) => i === 0 || d.index >= all[i - 1]!.end || d.iso !== all[i - 1]!.iso);
}

const EXPIRY_LABEL =
  /(valid\s*(?:up\s*)?(?:to|till|until|upto)|validity\s*(?:up\s*to|till|upto)?|expiry(?:\s*date)?|expires?(?:\s*on)?|expiring|policy\s*end|end\s*date|to\s*date|next\s*(?:due|test|inspection|renewal)|due\s*(?:date|on)|renewal\s*(?:date|due))/gi;
const ISSUE_LABEL =
  /(policy\s*(?:start|inception|commencement|effective)|inception|commencement|effective\s*(?:from|date)|start\s*date|valid\s*from|from\s*date|issue\s*date|date\s*of\s*issue|issued\s*on|date\s*of\s*(?:test|testing|inspection|fitness)|test\s*date|tested\s*on|inspected\s*on|date\s*of\s*registration)/gi;

/** The label of the given kind that ends closest before `index` (within a short distance), or -1. */
function nearestLabel(text: string, re: RegExp, index: number): number {
  let best = -1;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end <= index && index - end <= 45) best = Math.max(best, end);
  }
  return best;
}

function pickDates(text: string, kind: CertKind): Pick<ParsedCert, 'issueDate' | 'expiryDate'> {
  const dates = findDates(text);
  if (!dates.length) return {};

  // "Period of Insurance / Validity: From <date> To <date>" prints both dates together.
  // The separator must be a word or a spaced dash, so the hyphens inside 12-Nov-2025 are not mistaken for it.
  const range = text.match(/from\s*[:\-]?\s*(.{6,30}?)\s+(?:to|till|until|[-–])\s+(.{6,30})/i);
  let issue: string | undefined;
  let expiry: string | undefined;
  if (range) {
    const a = findDates(range[1]!)[0];
    const b = findDates(range[2]!)[0];
    if (a && b && a.iso < b.iso) {
      issue = a.iso;
      expiry = b.iso;
    }
  }

  for (const d of dates) {
    const exp = nearestLabel(text, EXPIRY_LABEL, d.index);
    const iss = nearestLabel(text, ISSUE_LABEL, d.index);
    if (exp < 0 && iss < 0) continue;
    // The closer label wins (so "Date of test ... Valid upto <date>" is not confused).
    if (exp > iss) expiry ??= d.iso;
    else issue ??= d.iso;
  }

  // Fall back to the earliest and latest date on the page.
  const sorted = dates.map((d) => d.iso).sort();
  if (!expiry) expiry = sorted.length > 1 ? sorted[sorted.length - 1] : kind === 'insurance' ? undefined : sorted[0];
  if (!issue && sorted.length > 1) issue = sorted[0];
  if (issue && expiry && issue >= expiry) {
    // Mis-assigned: keep the two extremes in order.
    issue = sorted[0];
    expiry = sorted[sorted.length - 1];
    if (issue === expiry) issue = undefined;
  }
  return { issueDate: issue, expiryDate: expiry };
}

/* -------------------------------------------------------------------------- */
/* Numbers, insurer, registration                                              */
/* -------------------------------------------------------------------------- */

const INSURERS: [RegExp, string][] = [
  [/ICICI\s*LOMBARD/i, 'ICICI Lombard'],
  [/HDFC\s*ERGO/i, 'HDFC ERGO'],
  [/NEW\s*INDIA\s*ASSURANCE/i, 'New India Assurance'],
  [/UNITED\s*INDIA\s*INSURANCE/i, 'United India Insurance'],
  [/ORIENTAL\s*INSURANCE/i, 'Oriental Insurance'],
  [/NATIONAL\s*INSURANCE/i, 'National Insurance'],
  [/BAJAJ\s*ALLIANZ/i, 'Bajaj Allianz'],
  [/TATA\s*AIG/i, 'Tata AIG'],
  [/RELIANCE\s*GENERAL/i, 'Reliance General'],
  [/SBI\s*GENERAL/i, 'SBI General'],
  [/ROYAL\s*SUNDARAM/i, 'Royal Sundaram'],
  [/IFFCO[\s-]*TOKIO/i, 'IFFCO Tokio'],
  [/CHOLAMANDALAM/i, 'Cholamandalam MS'],
  [/ZURICH\s*KOTAK|KOTAK\s*GENERAL/i, 'Zurich Kotak'],
  [/LIBERTY\s*GENERAL/i, 'Liberty General'],
  [/FUTURE\s*GENERALI/i, 'Future Generali'],
  [/GO\s*DIGIT|\bDIGIT\s*GENERAL/i, 'Go Digit'],
  [/\bACKO\b/i, 'Acko'],
  [/SHRIRAM\s*GENERAL/i, 'Shriram General'],
  [/UNIVERSAL\s*SOMPO/i, 'Universal Sompo'],
  [/MAGMA\s*HDI/i, 'Magma HDI'],
  [/NAVI\s*GENERAL/i, 'Navi General'],
  [/RAHEJA\s*QBE/i, 'Raheja QBE'],
];

function findInsurer(text: string): string | undefined {
  for (const [re, name] of INSURERS) if (re.test(text)) return name;
  const m = text.match(/([A-Z][A-Za-z&.' ]{2,40}?\s(?:General\s)?(?:Insurance|Assurance)(?:\sCompany)?(?:\s(?:Co\.?|Ltd\.?|Limited))*)/);
  return m ? m[1]!.replace(/\s+/g, ' ').trim() : undefined;
}

// Letters/digits/slashes, optionally printed in space-separated groups (2312 1003 4567 8900).
const NUMBER_VALUE = '([A-Z0-9][A-Z0-9/\\-]{3,29}(?:[ ][0-9]{3,6}){0,4})';

function findNumber(text: string, kind: CertKind): string | undefined {
  const patterns: RegExp[] =
    kind === 'insurance'
      ? [new RegExp(`policy\\s*(?:no|number|num|#)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i')]
      : kind === 'puc'
        ? [
            new RegExp(`(?:puc\\s*)?certificate\\s*(?:no|number|num|#)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i'),
            new RegExp(`(?:sl|serial)\\.?\\s*(?:no|number)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i'),
            new RegExp(`puc\\s*(?:no|number|#)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i'),
          ]
        : [
            new RegExp(`(?:certificate\\s*(?:of\\s*fitness\\s*)?|fitness\\s*(?:certificate\\s*)?|c\\.?f\\.?\\s*)(?:no|number|num|#)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i'),
            new RegExp(`(?:sl|serial)\\.?\\s*(?:no|number)\\.?[\\s:#.\\-]*${NUMBER_VALUE}`, 'i'),
          ];
  for (const re of patterns) {
    const m = text.match(re);
    const value = m?.[1]?.toUpperCase();
    // A real number has a digit; this rejects words that follow the label ("DATE", "ISSUED").
    if (value && /\d/.test(value) && !findDates(value).length) return value.replace(/[-/\s]+$/, '');
  }
  return undefined;
}

function findRegistration(text: string): string | undefined {
  const re = /(?<![A-Z0-9])([A-Z]{2}\s?-?\s?[0-9OSIL]{2}\s?-?\s?[A-Z0-9]{0,3}\s?-?\s?[0-9OSILBZ]{3,4})(?![A-Z0-9])/g;
  for (const m of text.toUpperCase().matchAll(re)) {
    const n = normaliseRegistrationNumber(m[1]!);
    if (n) return n;
  }
  return undefined;
}

/** Same vehicle? Compares registration numbers ignoring dashes and spaces. */
export const sameRegistration = (a?: string, b?: string) => {
  const clean = (s?: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return Boolean(clean(a) && clean(b)) && clean(a) === clean(b);
};

/** Parse one OCR pass. */
export function parseCertificate(kind: CertKind, rawText: string): ParsedCert {
  const text = rawText.replace(/\r/g, '').replace(/[‘’´`]/g, "'");
  const out: ParsedCert = { ...pickDates(text, kind) };
  const number = findNumber(text, kind);
  if (number) out.number = number;
  if (kind === 'insurance') {
    const provider = findInsurer(text);
    if (provider) out.provider = provider;
  }
  const reg = findRegistration(text);
  if (reg) out.registrationNumber = reg;
  return out;
}

/** Per field, the value most passes agree on (ties go to the earlier pass). */
export function mergeCertPasses(kind: CertKind, texts: string[]): ParsedCert {
  const parsed = texts.map((t) => parseCertificate(kind, t));
  const out: Record<string, unknown> = {};
  for (const key of new Set(parsed.flatMap((p) => Object.keys(p)))) {
    const votes = new Map<string, { value: unknown; count: number; first: number }>();
    parsed.forEach((p, i) => {
      const value = (p as Record<string, unknown>)[key];
      if (value === undefined) return;
      const id = JSON.stringify(value);
      const v = votes.get(id) ?? { value, count: 0, first: i };
      v.count += 1;
      votes.set(id, v);
    });
    const best = [...votes.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0];
    if (best) out[key] = best.value;
  }
  return out as ParsedCert;
}

/* -------------------------------------------------------------------------- */
/* Document -> fields                                                          */
/* -------------------------------------------------------------------------- */

export interface CertScanResult {
  parsed: ParsedCert;
  /** Lowest page confidence (0..100). */
  confidence: number;
}

/** Read a certificate: one or more files (PDF or photos). Uses the shared warm engines. */
export async function scanCertificateDocuments(
  kind: CertKind,
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<CertScanResult> {
  const images: Blob[] = [];
  for (const f of files) images.push(...(await documentToImages(f)));
  if (!images.length) throw new Error('No readable pages in the document');
  const pages = await recognizeImages(images, ['4', '11'], onProgress, { rotate: files.some((f) => !isPdf(f)) });

  // Each page is parsed on its own (a multi-page policy has the number on one page and
  // the dates on another), then the pages are merged; the two reading modes vote per page.
  const perPage = pages.map((passes) => mergeCertPasses(kind, passes.map((p) => p.text)));
  const merged: Record<string, unknown> = {};
  for (const page of perPage) {
    for (const [k, v] of Object.entries(page)) if (merged[k] === undefined) merged[k] = v;
  }
  // Dates across pages can come from different pages; re-derive from all text if still incomplete.
  const parsed = merged as ParsedCert;
  if (!parsed.issueDate || !parsed.expiryDate) {
    const all = parseCertificate(kind, pages.map((p) => p.map((x) => x.text).join('\n')).join('\n'));
    parsed.issueDate ??= all.issueDate;
    parsed.expiryDate ??= all.expiryDate;
  }
  const confidence = Math.min(...pages.map((p) => Math.max(...p.map((x) => x.confidence))));
  return { parsed, confidence };
}
