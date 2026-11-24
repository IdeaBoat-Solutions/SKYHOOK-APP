/**
 * Categories for the owner's Personal section. The five defaults ship with the
 * app; the owner can add their own (e.g. "Education Loan", "Bike Insurance").
 * Records are stored server-side with `kind` = the category's key, so this file
 * only holds the display definition, kept in this browser.
 */

/** A loan tracks an outstanding amount + EMI; a policy tracks cover + premium. */
export type PersonalCategoryType = 'loan' | 'policy';

export interface PersonalCategory {
  /** Stored on each record as its `kind`. */
  kind: string;
  label: string;
  description: string;
  /** Key into the shared icon catalogue (calcUi CALC_ICONS). */
  icon: string;
  type: PersonalCategoryType;
  /** True for the five built-ins, which cannot be removed. */
  builtin?: boolean;
}

export const DEFAULT_PERSONAL_CATEGORIES: PersonalCategory[] = [
  { kind: 'home_loan', label: 'Home Loan', description: 'Outstanding principal, EMI and next due date', icon: 'home', type: 'loan', builtin: true },
  { kind: 'family_insurance', label: 'Family Insurance', description: 'Health cover for the family', icon: 'heartpulse', type: 'policy', builtin: true },
  { kind: 'term_plan', label: 'Term Plan', description: 'Life cover and premium schedule', icon: 'shield', type: 'policy', builtin: true },
  { kind: 'auto_loan', label: 'Auto Loan', description: 'Vehicle finance and EMIs', icon: 'carfront', type: 'loan', builtin: true },
  { kind: 'auto_insurance', label: 'Auto Insurance', description: 'Motor policy and renewal dates', icon: 'car', type: 'policy', builtin: true },
];

export const PERSONAL_TYPE_META: Record<
  PersonalCategoryType,
  { label: string; hint: string; amountLabel: string; tone: string }
> = {
  loan: {
    label: 'Loan / EMI',
    hint: 'Tracks the outstanding amount and the monthly EMI',
    amountLabel: 'Outstanding',
    tone: 'bg-brand-50 text-brand-700',
  },
  policy: {
    label: 'Insurance / Policy',
    hint: 'Tracks the cover amount and the premium',
    amountLabel: 'Sum assured',
    tone: 'bg-success-50 text-success-700',
  },
};

const STORAGE_KEY = 'skyhook:personal:categories';

export function getCustomPersonalCategories(): PersonalCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PersonalCategory[]) : [];
    return Array.isArray(parsed) ? parsed.filter((c) => c && c.kind && c.label) : [];
  } catch {
    return [];
  }
}

export function saveCustomPersonalCategories(categories: PersonalCategory[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
  } catch {
    /* storage unavailable - categories last for this session only */
  }
}

/** Stable, URL-safe key for a new category, unique among `existing`. */
export function categoryKeyFor(label: string, existing: string[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'category';
  let key = base;
  let n = 2;
  while (existing.includes(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

/**
 * A record whose category is not defined here (e.g. created on another device)
 * still needs a home, so build a category from its key.
 */
export function categoryFromKind(kind: string): PersonalCategory {
  const label = kind
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const isLoan = /loan|emi|mortgage/.test(kind);
  return {
    kind,
    label: label || 'Other',
    description: 'Custom category',
    icon: isLoan ? 'bank' : 'shield',
    type: isLoan ? 'loan' : 'policy',
  };
}
