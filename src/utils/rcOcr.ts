/**
 * Indian vehicle Registration Certificate (RC smart card / Form 23A) OCR.
 *
 * document (PDF or photo) -> page images -> text (tesseract.js, on device)
 * -> structured fields (pure parser below, unit-testable without a browser).
 *
 * Card OCR is noisy: labels get dropped, the left column bleeds into the right
 * one, and S/5, O/0 swap. The parser is forgiving, merges several OCR passes,
 * and everything it returns is reviewed by a person before it is saved.
 */

import type { MachineType, RcDetails } from '../types';
import { STATE_BY_CODE } from './licenceOcr';
import { documentToImages, recognizeImages, type ScanProgress } from './ocrEngine';

export interface ParsedRc extends RcDetails {
  /** Normalised as GJ-38-S-1889. */
  registrationNumber?: string;
  /** Short make, e.g. "ACE" for "ACTION CONSTRUCTION EQUIPMENT LTD." */
  make?: string;
  model?: string;
  /** Best guess from the body type, e.g. HYDRAULIC MOBILE CRANE -> Hydraulic Crane. */
  machineType?: MachineType;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Look-alike fixes for characters that must be digits / letters. */
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', S: '5', I: '1', L: '1', B: '8', Z: '2', G: '6' };
const TO_LETTER: Record<string, string> = { '0': 'O', '5': 'S', '1': 'I', '8': 'B', '2': 'Z', '6': 'G', '4': 'A' };
const digits = (s: string) => s.replace(/[OQDSILBZG]/g, (c) => TO_DIGIT[c] ?? c);
const letters = (s: string) => s.replace(/[0-9]/g, (c) => TO_LETTER[c] ?? c);

function iso(d: string, m: string, y: string): string | undefined {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (year < 1950 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return undefined;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const DATE_RE = /(?<!\d)(\d{2})\s?[-/.]\s?(\d{2})\s?[-/.]\s?(\d{4})(?!\d)/g;

function datesIn(text: string): { iso: string; index: number }[] {
  const out: { iso: string; index: number }[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const value = iso(m[1]!, m[2]!, m[3]!);
    if (value) out.push({ iso: value, index: m.index ?? 0 });
  }
  return out;
}

const num = (s: string | undefined) => {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Labels printed on the card. Removed from value lines because two-column
 * layouts make the OCR put a left-column label on the same line as a value.
 */
const LABELS: RegExp[] = [
  /Regn\.?\s*(?:No|Number)\.?/gi,
  /Date\s*of\s*Regn\.?/gi,
  /Regn\.?\s*Va\S*/gi,
  /Owner\s*Serial/gi,
  /Chassis\s*No\.?/gi,
  /Engine\s*\/?\s*Motor\s*No\.?/gi,
  /Owner\s*Name/gi,
  /Son\s*\/?\s*Wife.*?Owner\)?/gi,
  /Ownership/gi,
  /Address/gi,
  /(?:Emiss)?[il]on\s*Norms/gi,
  /Fuel/gi,
  /Month\s*-?\s*Year\s*of\s*\S+/gi,
  /No\.?\s*of\s*Cyl\S*/gi,
  /Vehi\S*\s*Cla\S*\s*:?/gi,
  /Maker'?s?\s*Name\s*:?/gi,
  /Model\s*Name\s*:?/gi,
  /Colou?r\s*:?/gi,
  /Body\s*T\S*\s*:?/gi,
  /Seating\s*\(?in\s*all\)?\s*(?:Capacity)?/gi,
  /Un\S{0,2}aden\s*Weight\s*\(?Kg\)?/gi,
  /Cubic\s*Cap\S*/gi,
  /Horse\s*Power\s*\(?[A-Z/]*\)?/gi,
  /Wheel\s*Base\s*\S*/gi,
  /Financier\s*:?/gi,
  /Registration\s*Auth\S*/gi,
  /Card\s*Issue\s*Dat\S*/gi,
];

const stripLabels = (line: string) => LABELS.reduce((l, re) => l.replace(re, ' '), line);

/**
 * Clean one OCR'd value: drop leading bleed from the left column (a reg
 * number or a month-year) and trailing specks such as "bY", "A", "=".
 */
function cleanValue(raw: string): string {
  let tokens = stripLabels(raw)
    .replace(/[|_~“”"*{}<>»«©®§¥£$]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const junk = (t: string, upperField: boolean) =>
    !/[A-Za-z0-9]{2,}/.test(t) ||
    /^[A-Za-z]$/.test(t) ||
    (upperField && /[a-z]/.test(t) && t.length <= 3);
  const upperField = tokens.filter((t) => /[A-Z]{2,}/.test(t)).length >= tokens.length / 2;
  while (tokens.length && (junk(tokens[0]!, upperField) || /^[A-Z]{2}\d{2}[A-Z0-9]{3,8}$/.test(tokens[0]!) || /^\d{2}-\d{4}$/.test(tokens[0]!)))
    tokens = tokens.slice(1);
  while (tokens.length && junk(tokens[tokens.length - 1]!, upperField)) tokens = tokens.slice(0, -1);
  return tokens.join(' ').replace(/[,.;:\-]+$/, '').trim();
}

/** Lines of text with their start offset. */
function linesOf(text: string) {
  const out: { text: string; index: number }[] = [];
  let index = 0;
  for (const line of text.split('\n')) {
    out.push({ text: line, index });
    index += line.length + 1;
  }
  return out;
}

/**
 * The value that belongs to a label: what follows it on the same line when
 * that looks real, otherwise the next non-empty line(s).
 */
function valueAfter(text: string, label: RegExp, accept: (v: string) => boolean = (v) => v.length >= 2, lookahead = 2) {
  const m = label.exec(text);
  label.lastIndex = 0;
  if (!m) return undefined;
  const lines = linesOf(text);
  const at = lines.findIndex((l, i) => m.index! >= l.index && (i === lines.length - 1 || m.index! < lines[i + 1]!.index));
  if (at < 0) return undefined;
  const rest = cleanValue(lines[at]!.text.slice(m.index! - lines[at]!.index + m[0].length));
  if (accept(rest)) return rest;
  for (let i = at + 1, seen = 0; i < lines.length && seen < lookahead; i++) {
    const v = cleanValue(lines[i]!.text);
    if (!v) continue;
    seen += 1;
    if (accept(v)) return v;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Field finders                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Indian registration number: state(2) district(1-2) series(0-3 letters)
 * number(1-4 digits). OCR often reads the series letter as a digit
 * (GJ38S1889 -> GJ3851889); the 4-digit number rule recovers it.
 */
export function normaliseRegistrationNumber(raw: string): string | undefined {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = compact.match(/^([A-Z0-9]{2})([0-9OQDSILBZG]{2})([A-Z0-9]{1,7})$/);
  if (!m) return undefined;
  const state = letters(m[1]!);
  if (!(state in STATE_BY_CODE)) return undefined;
  const district = digits(m[2]!);
  const rest = m[3]!;
  // Number = trailing 4 chars (or fewer if the rest is short); series = the leading letters.
  const numLen = Math.min(4, rest.length);
  const series = letters(rest.slice(0, rest.length - numLen));
  const number = digits(rest.slice(rest.length - numLen));
  if (!/^\d{1,4}$/.test(number) || !/^[A-Z]{0,3}$/.test(series)) return undefined;
  if (rest.length - numLen > 3) return undefined;
  return [state, district, series, number].filter(Boolean).join('-');
}

function findRegistrationNumbers(text: string): string[] {
  const found: string[] = [];
  const re = /(?<![A-Z0-9])([A-Z]{2}\s?-?\s?[0-9OSIL]{2}\s?-?\s?[A-Z0-9]{0,3}\s?-?\s?[0-9OSILBZ]{3,4})(?![A-Z0-9])/g;
  for (const m of text.toUpperCase().matchAll(re)) {
    const n = normaliseRegistrationNumber(m[1]!);
    if (n) found.push(n);
  }
  return found;
}

/** 17-char VINs never use I, O or Q, so those are always digit misreads. */
function normaliseChassis(raw: string): string | undefined {
  let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 8 || c.length > 20) return undefined;
  if (c.length === 17) c = c.replace(/[OQ]/g, '0').replace(/I/g, '1');
  return c;
}

const MAKERS: [RegExp, string][] = [
  [/ACTION\s*CONSTRUCTION/i, 'ACE'],
  [/ESCORTS/i, 'Escorts'],
  [/LIEBHERR/i, 'Liebherr'],
  [/TADANO/i, 'Tadano'],
  [/KATO/i, 'Kato'],
  [/SANY/i, 'Sany'],
  [/ZOOMLION/i, 'Zoomlion'],
  [/XCMG/i, 'XCMG'],
  [/TATA\s*HITACHI/i, 'Tata Hitachi'],
  [/J\.?C\.?\s?B/i, 'JCB'],
  [/MANITOWOC|GROVE/i, 'Grove'],
  [/TEREX/i, 'Terex'],
  [/KOBELCO/i, 'Kobelco'],
  [/TIL\b|TRACTORS\s*INDIA/i, 'TIL'],
  [/MAHINDRA/i, 'Mahindra'],
  [/TATA\s*MOTORS/i, 'Tata'],
  [/ASHOK\s*LEYLAND/i, 'Ashok Leyland'],
];

export function shortMake(maker: string): string {
  for (const [re, short] of MAKERS) if (re.test(maker)) return short;
  return maker
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|INDIA|CO|COMPANY)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function machineTypeFromBody(body: string): MachineType | undefined {
  const b = body.toUpperCase();
  if (/CRAWLER/.test(b)) return 'Crawler Crane';
  if (/TOWER/.test(b)) return 'Tower Crane';
  if (/ALL\s*TERRAIN/.test(b)) return 'All Terrain Crane';
  if (/ROUGH\s*TERRAIN/.test(b)) return 'Rough Terrain Crane';
  if (/HYDRAULIC/.test(b)) return 'Hydraulic Crane';
  if (/MOBILE\s*CRANE|TRUCK\s*MOUNTED/.test(b)) return 'Mobile Crane';
  if (/HYDRA|PICK\s*(AND|N|&)\s*CARRY/.test(b)) return 'Hydra';
  if (/CRANE/.test(b)) return 'Other';
  return undefined;
}

const FUELS = ['DIESEL', 'PETROL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID'];

/** Parse one OCR pass. */
export function parseRegistrationCertificate(rawText: string): ParsedRc {
  const text = rawText.replace(/\r/g, '').replace(/[‘’´`]/g, "'");
  const out: ParsedRc = {};

  const regs = findRegistrationNumbers(text);
  if (regs.length) out.registrationNumber = regs[0];

  // ---- dates --------------------------------------------------------------
  const cardIssue = text.match(/Card\s*Issue\s*Dat\S*\s*\(?\s*(\d{2})[-/.](\d{2})[-/.](\d{4})/i)
    ?? text.match(/\(\s*(\d{2})[-/.](\d{2})[-/.](\d{4})\s*\)/);
  if (cardIssue) out.cardIssueDate = iso(cardIssue[1]!, cardIssue[2]!, cardIssue[3]!);
  const dates = datesIn(text).filter((d) => d.iso !== out.cardIssueDate);
  const regnLabel = text.search(/Date\s*of\s*Regn|Regn\.?\s*Va/i);
  const afterLabel = regnLabel >= 0 ? dates.filter((d) => d.index > regnLabel) : dates;
  const pair = afterLabel.length >= 2 ? afterLabel : dates;
  if (pair.length >= 2) {
    const [a, b] = [pair[0]!.iso, pair[1]!.iso].sort();
    out.registrationDate = a;
    out.registrationValidUpto = b;
  } else if (pair.length === 1) {
    out.registrationDate = pair[0]!.iso;
  }

  // ---- identity -----------------------------------------------------------
  const chassisLine = valueAfter(text, /Chassis\s*No\.?/i, (v) => /[A-Z0-9]{3,}/.test(v) && /\d/.test(v));
  if (chassisLine) out.chassisNumber = normaliseChassis(chassisLine);

  const isEngine = (v: string) => /^[A-Z0-9]{6,15}$/.test(v.replace(/\s/g, '')) && /\d{3}/.test(v) && /[A-Z]/.test(v);
  let engine = valueAfter(text, /Engine\s*\/?\s*Motor\s*No\.?/i, isEngine);
  if (!engine && out.chassisNumber) {
    // Label lost: the engine number is the next code-like line after the chassis number.
    const after = text.slice(text.search(/Chassis/i) + 1);
    engine = linesOf(after)
      .map((l) => cleanValue(l.text))
      .find((v) => isEngine(v) && normaliseChassis(v) !== out.chassisNumber);
  }
  if (engine) out.engineNumber = engine.replace(/\s/g, '').toUpperCase();

  const ownerName =
    valueAfter(text, /Owner\s*Name/i, (v) => /[A-Z]{3,}/.test(v)) ??
    (() => {
      const lines = linesOf(text);
      const i = lines.findIndex((l) => /Son\s*\/?\s*Wife|Daughter\s*of/i.test(l.text));
      for (let j = i - 1; i > 0 && j >= Math.max(0, i - 2); j--) {
        const v = cleanValue(lines[j]!.text);
        if (/^[A-Z][A-Z .&'-]{4,}$/.test(v)) return v;
      }
      return undefined;
    })();
  if (ownerName) out.ownerName = ownerName.toUpperCase();

  const ownership = text.match(/\b(FIRM|INDIVIDUAL|COMPANY|PARTNERSHIP|GOVERNMENT|TRUST)\b/);
  if (ownership) out.ownership = ownership[1];

  const serial = text.match(/Owner\s*(?:Serial)?[\s\S]{0,40}?Serial\s*\(?\s*([1-9])\b/i);
  if (serial) out.ownerSerial = Number(serial[1]);

  // Address: from the label (or first line with a house number) up to the PIN code.
  const pin = text.match(/[\s\S]{0,160}?\b\d{6}\b/g)?.find((chunk) => /[A-Z]{4,}/.test(chunk) && /-\s?\d{6}\b/.test(chunk));
  if (pin) {
    const addrStart = text.search(/Address/i);
    const chunk = addrStart >= 0 && text.indexOf(pin) <= addrStart + 200 ? text.slice(addrStart, text.indexOf(pin) + pin.length) : pin;
    const lines = chunk
      .split('\n')
      .map((l) =>
        cleanValue(
          l
            .replace(/^.*?Norms\s*/i, '')
            .replace(/BHARAT\s*STAGE\s*[IVX]*/i, '')
            .replace(/Address/i, ''),
        ),
      )
      .filter((l) => /[A-Z]{3,}/.test(l) && /\d|,|-/.test(l));
    const joined = lines.join(', ').replace(/\s*,\s*,/g, ',').replace(/\.\s*(?=[A-Z])/g, ', ');
    if (joined.length >= 8) out.ownerAddress = joined.toUpperCase();
  }

  const fuel = FUELS.find((f) => new RegExp(`\\b${f}\\b`).test(text.toUpperCase()));
  if (fuel) out.fuel = fuel;

  const bs = text.search(/BHARAT\s*STAGE/i);
  if (bs >= 0) {
    // Case-sensitive on purpose: OCR turns "III" into a lowercase "i"/"ih",
    // and a wrong stage is worse than none.
    const near = text.slice(bs, bs + 90);
    const roman = near.match(/(?<![A-Za-z])(VI|IV|V|III|II)(?![A-Za-z])/)?.[1];
    const suffix = near.match(/\((CEV|TREM)\)/i)?.[1];
    out.emissionNorms = ['BHARAT STAGE', roman, suffix && `(${suffix.toUpperCase()})`].filter(Boolean).join(' ');
  }

  // ---- back of the card ---------------------------------------------------
  const vClass = valueAfter(text, /Vehi\S*\s*Cla\S*\s*:?/i, (v) => /[A-Z]{4,}/.test(v));
  if (vClass) out.vehicleClass = vClass.toUpperCase().replace(/\s*\(\s*0TH\s*\)/, ' (OTH)');

  const maker = valueAfter(text, /Maker'?s?\s*Name\s*:?/i, (v) => /[A-Z]{3,}\s+[A-Z]{3,}/.test(v));
  if (maker) {
    out.makerName = maker.toUpperCase();
    out.make = shortMake(out.makerName);
  }

  const modelLine = valueAfter(text, /Model\s*Name\s*:?/i, (v) => /[A-Z]/i.test(v) && /\d/.test(v));
  if (modelLine) {
    const token = modelLine
      .toUpperCase()
      .split(/\s+/)
      .find((t) => /^[A-Z]{1,5}[- ]?\d{2,4}[A-Z0-9-]{0,6}$/.test(t));
    if (token) out.model = token;
  }

  const colourBody = valueAfter(text, /Colou?r\s*:?\s*\/?\s*(?:Body\s*T\S*\s*:?)?/i, (v) => v.includes('/') || /CRANE|BODY|OPEN|CLOSED/i.test(v));
  if (colourBody) {
    const [colour, body] = colourBody.split('/').map((s) => cleanValue(s).toUpperCase());
    if (colour) out.colour = colour;
    if (body) {
      out.bodyType = body.replace(/\bCRAN[A-Z]?\b\.?$/, 'CRANE').replace(/CRANS\b/, 'CRANE');
      out.machineType = machineTypeFromBody(out.bodyType);
    }
  }

  const smallInt = (label: RegExp, max: number) => {
    const m = label.exec(text);
    if (!m) return undefined;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    for (const n of tail.matchAll(/(?<![\d.])(\d{1,2})(?![\d.]|\s*[-/]\s*\d)/g)) {
      const v = Number(n[1]);
      if (v >= 1 && v <= max) return v;
    }
    return undefined;
  };
  out.cylinders = smallInt(/No\.?\s*of\s*Cyl\S*/i, 16);
  out.seatingCapacity = smallInt(/Seating\s*\(?in\s*all\)?(?:\s*Capacity)?/i, 60);

  const weight = text.match(/Un\S{0,2}aden\s*Weight[^\n]*\n?[^\d]{0,30}?(\d{3,6})(?!\d)/i);
  if (weight) out.unladenWeightKg = num(weight[1]);

  const power = text.match(/(?<![\d.])(\d{3,5}\.\d{1,2})\s*\n?\s*\/\s*(\d{1,4}(?:\.\d{1,2})?)(?:\s*\n?\s*(\d{3,5})(?![\d.]))?/);
  if (power) {
    out.cubicCapacityCc = num(power[1]);
    out.horsePower = num(power[2]);
    if (power[3] && Number(power[3]) >= 1000) out.wheelBaseMm = num(power[3]);
  }

  const mfg = text.match(/(?<![\d-])(0[1-9]|1[0-2])\s?[-/]\s?((?:19|20)\d{2})(?![\d-])/);
  if (mfg) out.manufactureMonthYear = `${mfg[1]}-${mfg[2]}`;

  const financier = valueAfter(text, /Financier\s*:?/i, (v) => /[A-Z]{3,}\s+[A-Z]{3,}/.test(v));
  if (financier) out.financier = financier.toUpperCase();

  const authority = valueAfter(text, /Registration\s*Auth\S*/i, (v) => /[A-Za-z]{4,}/.test(v));
  if (authority) out.registrationAuthority = authority;

  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== '')) as ParsedRc;
}

/**
 * Merge several OCR passes. Each field takes the value most passes agree on;
 * ties go to the earlier (better) pass. The registration number is voted on
 * across every occurrence, since it is printed on both sides of the card.
 */
export function mergeRcPasses(texts: string[]): ParsedRc {
  const parsed = texts.map(parseRegistrationCertificate);
  const out: Record<string, unknown> = {};
  const keys = new Set(parsed.flatMap((p) => Object.keys(p)));
  for (const key of keys) {
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

  const allRegs = texts.flatMap(findRegistrationNumbers);
  if (allRegs.length) {
    const tally = new Map<string, number>();
    for (const r of allRegs) tally.set(r, (tally.get(r) ?? 0) + (/-\d{4}$/.test(r) ? 2 : 1));
    out.registrationNumber = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return out as ParsedRc;
}

/* -------------------------------------------------------------------------- */
/* Document -> fields                                                          */
/* -------------------------------------------------------------------------- */

export interface RcScanResult {
  parsed: ParsedRc;
  /** Lowest page confidence (0..100). */
  confidence: number;
  pages: number;
  text: string;
}

/**
 * OCR one or more RC files (a two-page PDF, or front/back photos). Each page
 * is read twice: column mode (PSM 4) keeps label/value lines together and
 * sparse mode (PSM 11) recovers lines that column mode drops.
 */
export async function scanRcDocuments(
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<RcScanResult> {
  const images: Blob[] = [];
  for (const file of files) {
    onProgress?.({ status: `Opening ${file.name}`, progress: 0 });
    images.push(...(await documentToImages(file)));
  }
  if (!images.length) throw new Error('No readable pages in the document');

  const pages = await recognizeImages(images, ['4', '11'], onProgress);
  // Pass order matters for tie-breaks: all column-mode text first.
  const columnText = pages.map((p) => p[0]!.text).join('\n');
  const sparseText = pages.map((p) => p[1]!.text).join('\n');
  const parsed = mergeRcPasses([columnText, sparseText]);
  const confidence = Math.min(...pages.map((p) => Math.max(...p.map((x) => x.confidence))));
  return { parsed, confidence, pages: images.length, text: `${columnText}\n${sparseText}` };
}
