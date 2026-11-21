/**
 * Aadhaar card OCR: front and back (or an e-Aadhaar PDF) -> text (tesseract.js on
 * this device) -> name, date of birth, gender, guardian, address and number.
 * Like the other scanners, the parser is forgiving and a person reviews the result.
 */

import { documentToImages, isPdf, recognizeImages, type ScanProgress } from './ocrEngine';

export interface ParsedAadhaar {
  /** 12 digits, no spaces. Shown masked; not stored. */
  number?: string;
  name?: string;
  dateOfBirth?: string; // ISO yyyy-mm-dd
  yearOfBirth?: string; // when the card only prints the year
  gender?: 'MALE' | 'FEMALE' | 'TRANSGENDER';
  guardianName?: string; // S/O, D/O, W/O, C/O
  address?: string;
}

const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8' };
const fixDigits = (s: string) => s.replace(/[OoIlSB]/g, (c) => DIGIT_FIX[c] ?? c);

const NAME_BLACKLIST =
  /GOVERNMENT|INDIA|UNIQUE|IDENTIFICATION|AUTHORITY|AADHAAR|ADDRESS|MALE|FEMALE|DOB|BIRTH|YEAR|VID|ENROLMENT|DOWNLOAD|ISSUE|DETAILS|SIGNATURE|DIGITALLY|SIGNED|HELP|WWW|UIDAI|GOV/i;

function iso(d: string, m: string, y: string): string | undefined {
  const day = Number(d), month = Number(m), year = Number(y);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) return undefined;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Aadhaar numbers are 12 digits, never start with 0 or 1; a 16-digit VID must not be mistaken for one. */
function findNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d])([2-9OIlSB]\d{3})\s?(\d{4})\s?(\d{4})(?![\d]|\s\d{4})/g)) {
    out.push(fixDigits(`${m[1]}${m[2]}${m[3]}`));
  }
  return out.filter((n) => /^[2-9]\d{11}$/.test(n));
}

function findName(lines: string[], dobIndex: number): string | undefined {
  const isName = (l: string) => {
    const words = l.replace(/[^A-Za-z .'-]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    return (
      words.length >= 1 &&
      words.join('').length >= 4 &&
      !NAME_BLACKLIST.test(l) &&
      !/\d/.test(l) &&
      /^[A-Za-z .'-]+$/.test(l.trim())
    );
  };
  // The name is printed just above the date of birth.
  for (let i = (dobIndex >= 0 ? dobIndex : lines.length) - 1; i >= 0 && i >= dobIndex - 4; i--) {
    const l = lines[i]!.trim();
    if (l && isName(l)) return l.replace(/\s+/g, ' ').toUpperCase();
  }
  return undefined;
}

export function parseAadhaar(rawText: string): ParsedAadhaar {
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n');
  const out: ParsedAadhaar = {};

  const numbers = findNumbers(text);
  if (numbers.length) {
    const tally = new Map<string, number>();
    numbers.forEach((n) => tally.set(n, (tally.get(n) ?? 0) + 1));
    out.number = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }

  const dob = text.match(/(?:DOB|D\.?O\.?B|Date\s*of\s*Birth|Birth)\s*[:\-/]*\s*(\d{2})\s?[/\-.]\s?(\d{2})\s?[/\-.]\s?(\d{4})/i);
  const loose = dob ?? text.match(/(?<!\d)(\d{2})[/\-.](\d{2})[/\-.](\d{4})(?!\d)/);
  if (loose) out.dateOfBirth = iso(loose[1]!, loose[2]!, loose[3]!);
  if (!out.dateOfBirth) {
    const y = text.match(/Year\s*of\s*Birth\s*[:\-]*\s*(\d{4})/i);
    if (y) out.yearOfBirth = y[1];
  }

  const gender = text.toUpperCase().match(/\b(TRANSGENDER|FEMALE|MALE)\b/);
  if (gender) out.gender = gender[1] as ParsedAadhaar['gender'];

  const dobIndex = lines.findIndex((l) => /DOB|Birth|\d{2}[/\-.]\d{2}[/\-.]\d{4}/i.test(l));
  const name = findName(lines, dobIndex);
  if (name) out.name = name;

  const care = text.match(/\b(?:S\/O|D\/O|W\/O|C\/O)\s*[:.\-]*\s*([A-Za-z][A-Za-z .'-]{2,40}?)(?=\s*[,\n]|$)/i);
  if (care) out.guardianName = care[1]!.trim().toUpperCase();

  const addr = text.match(/Address\s*[:\-]*\s*([\s\S]*?\b\d{3}\s?\d{3}\b)/i);
  if (addr) {
    const joined = addr[1]!
      .split('\n')
      .map((l) => l.replace(/[|_~]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 1 && /[A-Za-z0-9]/.test(l) && !/^\d{4}\s?\d{4}\s?\d{4}$/.test(l))
      .join(', ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',');
    if (joined.length >= 10) out.address = joined.toUpperCase();
  }
  return out;
}

/** Take, per field, the value most passes agree on (ties go to the earlier pass). */
export function mergeAadhaarPasses(texts: string[]): ParsedAadhaar {
  const parsed = texts.map(parseAadhaar);
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
  return out as ParsedAadhaar;
}

export const maskAadhaar = (n?: string) => (n && n.length === 12 ? `XXXX XXXX ${n.slice(8)}` : '');

export interface AadhaarScanResult {
  parsed: ParsedAadhaar;
  confidence: number;
}

/** OCR one or more Aadhaar files (front photo, back photo, or a PDF) and merge what they show. */
export async function scanAadhaarDocuments(
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<AadhaarScanResult> {
  const images: Blob[] = [];
  for (const f of files) images.push(...(await documentToImages(f)));
  if (!images.length) throw new Error('No readable pages in the document');
  const pages = await recognizeImages(images, ['4', '11'], onProgress, { rotate: files.some((f) => !isPdf(f)) });

  // Each side is parsed on its own (front has name/DOB, back has the address), then merged.
  const perSide = pages.map((passes) => mergeAadhaarPasses(passes.map((p) => p.text)));
  const merged: Record<string, unknown> = {};
  for (const side of perSide) {
    for (const [k, v] of Object.entries(side)) if (merged[k] === undefined) merged[k] = v;
  }
  const confidence = Math.min(...pages.map((p) => Math.max(...p.map((x) => x.confidence))));
  return { parsed: merged as ParsedAadhaar, confidence };
}
