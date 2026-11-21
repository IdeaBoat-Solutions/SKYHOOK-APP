/**
 * Indian driving-licence OCR: image -> text (tesseract.js, runs in the browser,
 * the photo never leaves the device) -> structured fields (pure parser below).
 *
 * OCR on phone photos is noisy, so the parser is forgiving and everything it
 * returns is meant to be reviewed and corrected by a person before saving.
 */

import { documentToImages, isPdf, recognizeImages, type ScanProgress } from './ocrEngine';

export type { ScanProgress };

export interface ParsedLicence {
  licenceNumber?: string;
  name?: string;
  dateOfBirth?: string; // ISO yyyy-mm-dd
  guardianName?: string; // Son/Daughter/Wife of
  bloodGroup?: string;
  address?: string;
  issueDate?: string;
  validNt?: string; // validity, non-transport
  validTr?: string; // validity, transport
  firstIssueDate?: string;
  issuingState?: string;
  issuingAuthority?: string;
  vehicleClasses?: string[];
  organDonor?: boolean;
}

export const STATE_BY_CODE: Record<string, string> = {
  AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar',
  CG: 'Chhattisgarh', CH: 'Chandigarh', DD: 'Daman & Diu', DL: 'Delhi', DN: 'Dadra & Nagar Haveli',
  GA: 'Goa', GJ: 'Gujarat', HP: 'Himachal Pradesh', HR: 'Haryana', JH: 'Jharkhand',
  JK: 'Jammu & Kashmir', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
  MH: 'Maharashtra', ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram',
  NL: 'Nagaland', OD: 'Odisha', OR: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan',
  SK: 'Sikkim', TN: 'Tamil Nadu', TR: 'Tripura', TS: 'Telangana', UK: 'Uttarakhand',
  UP: 'Uttar Pradesh', WB: 'West Bengal',
};

/** Vehicle-class codes printed on the back of the card. */
export const VEHICLE_CLASS_CODES = [
  'MCWOG', 'MCWG', 'MC 50CC', 'LMV-NT', 'LMV-TR', 'LMV', 'TRANS', 'HGMV', 'HPMV', 'HTV', 'HMV',
  'MGV', 'LTV', 'TRCTR', 'ADPVEH', 'ROADROLLER',
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** OCR reads digits as look-alike letters (and the reverse) inside number fields. */
const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', S: '5', I: '1', L: '1', B: '8', Z: '2' };
const toDigits = (s: string) => s.replace(/[OQDSILBZ]/g, (c) => DIGIT_FIX[c] ?? c);

function iso(d: string, m: string, y: string): string | undefined {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return undefined; // e.g. 31-02
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** dd-mm-yyyy with whatever separator the OCR produced (- / . ' space). */
const DATE_RE = /(\d{2})\s?[-/.'’‘`,\s]\s?(\d{2})\s?[-/.'’‘`,\s]\s?(\d{4})/g;

function allDates(text: string): { iso: string; index: number }[] {
  const out: { iso: string; index: number }[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const value = iso(m[1]!, m[2]!, m[3]!);
    if (value) out.push({ iso: value, index: m.index ?? 0 });
  }
  return out;
}

export function normaliseLicenceNumber(raw: string): string | undefined {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // state(2) + RTO(2) + year(4) + serial(7)
  const m = compact.match(/^([A-Z]{2})([0-9OQDSILBZ]{2})([0-9OQDSILBZ]{4})([0-9OQDSILBZ]{7})$/);
  if (!m || !(m[1]! in STATE_BY_CODE)) return undefined;
  const rto = toDigits(m[2]!);
  const year = toDigits(m[3]!);
  const serial = toDigits(m[4]!);
  if (Number(year) < 1950 || Number(year) > 2100) return undefined;
  return `${m[1]}${rto} ${year}${serial}`;
}

function findLicenceNumber(text: string): string | undefined {
  const re = /\b([A-Z]{2}[\s-]?[0-9OQDSILBZ]{2}[\s-]?[0-9OQDSILBZ]{4}[\s-]?[0-9OQDSILBZ]{7})\b/g;
  for (const m of text.toUpperCase().matchAll(re)) {
    const normal = normaliseLicenceNumber(m[1]!);
    if (normal) return normal;
  }
  return undefined;
}

const cleanWords = (s: string) =>
  s.replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();

function findName(text: string): string | undefined {
  const m = text.match(/\bName\b[\s:.\-|]*([A-Z][A-Za-z .'-]{1,60}?)(?=\s*(?:\n|Date|Blood|Son|Daughter|Wife|$))/);
  const name = m ? cleanWords(m[1]!) : '';
  return name.length >= 2 ? name.toUpperCase() : undefined;
}

function findGuardian(text: string): string | undefined {
  const m = text.match(/(?:Son|Daughter|Wife)[\s/A-Za-z]{0,18}?\bof\b[\s:.\-|]*([A-Z][A-Za-z .'-]{1,60}?)(?=\s*(?:\n|Address|$))/i);
  const name = m ? cleanWords(m[1]!) : '';
  return name.length >= 2 ? name.toUpperCase() : undefined;
}

function findBloodGroup(text: string): string | undefined {
  const m = text.match(/Blood\s*Gr[a-z]*[\s:.\-|]*(AB|A|B|O|0)\s*([+-]|pos|neg)?/i);
  if (!m) return undefined;
  const group = m[1]!.toUpperCase() === '0' ? 'O' : m[1]!.toUpperCase();
  const sign = !m[2] ? '' : /^(\+|pos)/i.test(m[2]) ? '+' : '-';
  const full = `${group}${sign}`;
  return BLOOD_GROUPS.includes(full) ? full : undefined;
}

function findAddress(text: string): string | undefined {
  const m = text.match(/Address[\s:.\-|]*([\s\S]+?)(?=\n\s*(?:Organ|Date of First|Holder|Valid|Issue|Signature|\(?\d{2}[-/.]\d{2}[-/.]\d{4}\)?\s*$)|$)/i);
  if (!m) return undefined;
  const lines = m[1]!
    .split('\n')
    .map((l) => l.replace(/[|_~]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2 && /[A-Za-z]/.test(l));
  const joined = lines.join(', ').replace(/,\s*,/g, ',').trim();
  return joined.length >= 5 ? joined.toUpperCase() : undefined;
}

export function parseDrivingLicence(rawText: string): ParsedLicence {
  const text = rawText.replace(/\r/g, '').replace(/[‘’´`]/g, "'");
  const result: ParsedLicence = {};

  const number = findLicenceNumber(text);
  if (number) {
    result.licenceNumber = number;
    result.issuingState = STATE_BY_CODE[number.slice(0, 2)];
  }

  const stateLine = text.match(/Issued\s*by[\s:.\-|]*([A-Za-z][A-Za-z &]{2,30})/i);
  if (stateLine) {
    const found = Object.values(STATE_BY_CODE).find(
      (s) => s.toLowerCase() === cleanWords(stateLine[1]!).toLowerCase(),
    );
    if (found) result.issuingState = found;
  }

  const name = findName(text);
  if (name) result.name = name;
  const guardian = findGuardian(text);
  if (guardian) result.guardianName = guardian;
  const blood = findBloodGroup(text);
  if (blood) result.bloodGroup = blood;
  const address = findAddress(text);
  if (address) result.address = address;

  const donor = text.match(/Organ\s*Donor[\s:.\-|]*([YN])\b/i);
  if (donor) result.organDonor = donor[1]!.toUpperCase() === 'Y';

  const authority = text.match(/Licensing\s*Authority[\s:.\-|]*([A-Za-z][A-Za-z ]{2,40})/i);
  if (authority) result.issuingAuthority = cleanWords(authority[1]!).toUpperCase();

  // ---- dates --------------------------------------------------------------
  const dates = allDates(text);
  const used = new Set<number>();
  const take = (index: number) => used.add(index);

  const dobLabel = text.search(/Birth|\bD\.?O\.?B\b/i);
  if (dobLabel >= 0) {
    const dob = dates.find((d) => d.index >= dobLabel && d.index - dobLabel < 40);
    if (dob) {
      result.dateOfBirth = dob.iso;
      take(dob.index);
    }
  }

  const firstLabel = text.search(/First\s*Issue/i);
  const parenthesised = text.match(/\(\s*(\d{2})\s?[-/.'\s]\s?(\d{2})\s?[-/.'\s]\s?(\d{4})\s*\)/);
  if (parenthesised) {
    const first = iso(parenthesised[1]!, parenthesised[2]!, parenthesised[3]!);
    if (first) {
      result.firstIssueDate = first;
      const idx = dates.find((d) => d.iso === first)?.index;
      if (idx !== undefined) take(idx);
    }
  } else if (firstLabel >= 0) {
    const first = dates.find((d) => d.index >= firstLabel && d.index - firstLabel < 60);
    if (first) {
      result.firstIssueDate = first.iso;
      take(first.index);
    }
  }

  // Validity dates are read by their (NT) / (TR) labels when the card text carries them,
  // so a missing or unreadable date cannot shift the others into the wrong field.
  const labelled = (re: RegExp) => {
    const at = text.search(re);
    if (at < 0) return undefined;
    return dates.find((d) => !used.has(d.index) && d.index >= at && d.index - at < 45);
  };
  const ntHit = labelled(/\(\s*NT\s*\)|\bNon[\s-]*Transport\b/i);
  const trHit = labelled(/\(\s*TR\s*\)|(?<!Non[\s-]*)\bTransport\b/i);
  if (ntHit || trHit) {
    if (ntHit) { result.validNt = ntHit.iso; take(ntHit.index); }
    if (trHit) { result.validTr = trHit.iso; take(trHit.index); }
    const issue = dates.find((d) => !used.has(d.index));
    if (issue) result.issueDate = issue.iso;
    // Back-fill vehicle classes below and skip the positional guess.
  }

  // Otherwise the remaining dates appear in the order: issue, validity (NT), validity (TR).
  const rest = ntHit || trHit ? [] : dates.filter((d) => !used.has(d.index)).map((d) => d.iso);
  if (rest.length >= 3) {
    [result.issueDate, result.validNt, result.validTr] = rest;
  } else if (rest.length === 2) {
    [result.issueDate, result.validNt] = rest;
  } else if (rest.length === 1) {
    result.issueDate = rest[0];
  }

  // ---- vehicle classes (back of the card) ----------------------------------
  const upper = text.toUpperCase();
  const classes = VEHICLE_CLASS_CODES.filter((code) =>
    new RegExp(`(?:^|[^A-Z0-9-])${code.replace(/[- ]/g, '[- ]?')}(?:$|[^A-Z0-9-])`).test(upper),
  );
  // LMV is also a prefix of LMV-NT / LMV-TR; keep the longest specific match.
  const filtered = classes.filter((c) => !(c === 'LMV' && (classes.includes('LMV-NT') || classes.includes('LMV-TR'))));
  if (filtered.length) result.vehicleClasses = filtered;

  return result;
}

/** Fill gaps in `primary` from `secondary` (front side wins on conflicts). */
export function mergeParsed(primary: ParsedLicence, secondary: ParsedLicence): ParsedLicence {
  const out: ParsedLicence = { ...secondary };
  for (const [key, value] of Object.entries(primary)) {
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  const classes = [...new Set([...(primary.vehicleClasses ?? []), ...(secondary.vehicleClasses ?? [])])];
  if (classes.length) out.vehicleClasses = classes;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Image -> text                                                               */
/* -------------------------------------------------------------------------- */

export interface ScanResult {
  text: string;
  confidence: number;
  parsed: ParsedLicence;
}

const fieldCount = (p: ParsedLicence) =>
  Object.values(p).filter((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined)).length;

export interface LicenceFilesResult {
  parsed: ParsedLicence;
  confidence: number;
  /** The file that carries the main details (number, name, dates) and the other side, if any. */
  front?: File;
  back?: File;
}

/**
 * Read every file together (front, back, or a PDF) and merge what they show. The sides do
 * not have to be added in order: the page with the most details is treated as the front
 * and wins any conflict, the other fills gaps (vehicle classes, authority).
 * All pages are read in parallel on the warm engines.
 */
export async function scanLicenceFiles(
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<LicenceFilesResult> {
  const pages: { blob: Blob; file: File }[] = [];
  for (const file of files) {
    for (const blob of await documentToImages(file)) pages.push({ blob, file });
  }
  if (!pages.length) throw new Error('No readable pages in the document');

  // PSM 3 (fully automatic) reads the card layout best in testing.
  const read = await recognizeImages(pages.map((p) => p.blob), ['3'], onProgress, { rotate: files.some((f) => !isPdf(f)) });
  const parsed = read.map(([pass]) => ({ pass: pass!, fields: parseDrivingLicence(pass!.text) }));
  const ranked = parsed
    .map((p, i) => ({ ...p, file: pages[i]!.file, count: fieldCount(p.fields) }))
    .sort((a, b) => b.count - a.count);

  let merged: ParsedLicence = {};
  for (const r of [...ranked].reverse()) merged = mergeParsed(r.fields, merged);
  // mergeParsed lets its first argument win, so fold from the weakest page up to the strongest.
  const front = ranked[0]?.file;
  const back = ranked.find((r) => r.file !== front)?.file;
  return {
    parsed: merged,
    confidence: Math.min(...parsed.map((p) => p.pass.confidence)),
    front,
    back,
  };
}

/** Run OCR on one image (kept for callers that read a single photo). */
export async function scanLicenceImage(
  file: File,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  const [[pass]] = await recognizeImages([file], ['3'], onProgress, { rotate: true });
  return { text: pass!.text, confidence: pass!.confidence, parsed: parseDrivingLicence(pass!.text) };
}
