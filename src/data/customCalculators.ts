/**
 * User-built calculators for the Calculations module.
 * Browser-persisted for now; no API model exists for these yet.
 */
import type { CalcUnit } from './localExtras';

export type { CalcUnit };

export interface CustomCalcField {
  id: string;
  /** Variable name used in formulas, e.g. "diesel_litres". */
  key: string;
  label: string;
  unit: CalcUnit;
}

export interface CustomCalcOutput {
  id: string;
  key: string;
  label: string;
  formula: string;
  unit: CalcUnit;
}

export interface CustomCalcEntry {
  id: string;
  title: string;
  date: string;
  /** Keyed by field id so renaming a field keeps saved entries intact. */
  values: Record<string, number>;
}

export interface CustomCalculator {
  id: string;
  name: string;
  description: string;
  /** Key into the calculator icon catalogue. */
  icon: string;
  fields: CustomCalcField[];
  outputs: CustomCalcOutput[];
  entries: CustomCalcEntry[];
  createdAt: string;
}

const STORAGE_KEY = 'skyhook:calculations:custom';

export function getCustomCalculators(): CustomCalculator[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomCalculator[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomCalculators(calculators: CustomCalculator[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calculators));
  } catch {
    /* storage unavailable - keep running with in-memory values */
  }
}
