import React, { useEffect, useMemo, useState } from 'react';
import {
  Lock,
  Unlock,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  Landmark,
  KeyRound,
  Delete,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { PersonalRecord, PersonalRecordKind } from '../../types';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import {
  DEFAULT_PERSONAL_CATEGORIES,
  PERSONAL_TYPE_META,
  PersonalCategory,
  PersonalCategoryType,
  categoryFromKind,
  categoryKeyFor,
  getCustomPersonalCategories,
  saveCustomPersonalCategories,
} from '../../data/personalCategories';
import { CALC_ICONS, calcIcon } from '../calculations/calcUi';

const EMPTY_FORM = {
  title: '',
  provider: '',
  referenceNumber: '',
  amount: '',
  periodicAmount: '',
  startDate: '',
  dueDate: '',
  notes: '',
};

/** Owner-only private vault. PIN protects this browser's view of the records. */
export const PersonalView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    personalPinSet,
    setPersonalPin,
    verifyPersonalPin,
    personalRecords,
    addPersonalRecord,
    updatePersonalRecord,
    deletePersonalRecord,
  } = useSkyhook();

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);

  const [activeKind, setActiveKind] = useState<PersonalRecordKind>('home_loan');
  const [customCategories, setCustomCategories] = useState<PersonalCategory[]>(getCustomPersonalCategories);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState<{
    label: string;
    description: string;
    type: PersonalCategoryType;
    icon: string;
  }>({ label: '', description: '', type: 'loan', icon: 'bank' });
  const [categoryError, setCategoryError] = useState('');
  const [editing, setEditing] = useState<PersonalRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const isOwner = currentUser.role === 'owner';
  const locked = personalPinSet && !unlocked;

  const submitPin = (value: string) => {
    if (!personalPinSet) {
      if (!/^\d{4}$/.test(value)) {
        setPinError('Enter exactly 4 digits.');
        return;
      }
      if (value !== confirmPin) {
        setPinError('Both PIN entries must match.');
        return;
      }
      void setPersonalPin(value);
      setPin('');
      setConfirmPin('');
      setPinError('');
      setUnlocked(true);
      return;
    }
    if (cooldown > 0) return;
    if (verifyPersonalPin(value)) {
      setUnlocked(true);
      setPin('');
      setPinError('');
      setAttempts(0);
    } else {
      const next = attempts + 1;
      setAttempts(next);
      setPin('');
      if (next >= 5) {
        setCooldown(15);
        setAttempts(0);
        setPinError('Too many attempts. Try again in 15 seconds.');
      } else {
        setPinError(`Incorrect PIN. ${5 - next} attempt${5 - next === 1 ? '' : 's'} remaining.`);
      }
    }
  };

  const handlePinChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    setPinError('');
    if (digits.length === 4 && (!personalPinSet || cooldown === 0)) submitPin(digits);
  };

  /** Defaults, then the owner's own, then any kind found only on records. */
  const categories = useMemo(() => {
    const known = [...DEFAULT_PERSONAL_CATEGORIES, ...customCategories];
    const knownKinds = new Set(known.map((c) => c.kind));
    const orphans = [...new Set(personalRecords.map((r) => r.kind))]
      .filter((k) => !knownKinds.has(k))
      .map(categoryFromKind);
    return [...known, ...orphans];
  }, [customCategories, personalRecords]);

  const categoryOf = (kind: PersonalRecordKind): PersonalCategory =>
    categories.find((c) => c.kind === kind) ?? categoryFromKind(kind);

  const recordsFor = (kind: PersonalRecordKind) =>
    personalRecords.filter((r) => r.kind === kind);

  const totals = useMemo(() => {
    const typeOf = (kind: string) =>
      (categories.find((c) => c.kind === kind) ?? categoryFromKind(kind)).type;
    const loans = personalRecords
      .filter((r) => typeOf(r.kind) === 'loan')
      .reduce((sum, r) => sum + (r.amount || 0), 0);
    const cover = personalRecords
      .filter((r) => typeOf(r.kind) === 'policy')
      .reduce((sum, r) => sum + (r.amount || 0), 0);
    const annualPremium = personalRecords
      .filter((r) => typeOf(r.kind) === 'policy')
      .reduce((sum, r) => sum + (r.periodicAmount || 0) * 12, 0);
    const today = new Date(`${currentDate}T00:00:00`);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 30);
    const upcoming = personalRecords.filter((r) => {
      if (!r.dueDate) return false;
      const due = new Date(`${r.dueDate}T00:00:00`);
      return due >= today && due <= horizon;
    }).length;
    return { loans, cover, annualPremium, upcoming };
  }, [personalRecords, categories, currentDate]);

  const openCategoryForm = () => {
    setCategoryForm({ label: '', description: '', type: 'loan', icon: 'bank' });
    setCategoryError('');
    setShowCategoryForm(true);
  };

  const handleCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const label = categoryForm.label.trim();
    if (!label) {
      setCategoryError('Give the category a name.');
      return;
    }
    if (categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      setCategoryError('A category with this name already exists.');
      return;
    }
    const kind = categoryKeyFor(label, categories.map((c) => c.kind));
    const next: PersonalCategory[] = [
      ...customCategories,
      {
        kind,
        label,
        description: categoryForm.description.trim() || PERSONAL_TYPE_META[categoryForm.type].hint,
        icon: categoryForm.icon,
        type: categoryForm.type,
      },
    ];
    setCustomCategories(next);
    saveCustomPersonalCategories(next);
    setActiveKind(kind);
    setShowCategoryForm(false);
  };

  const removeCategory = (cat: PersonalCategory) => {
    if (recordsFor(cat.kind).length > 0) {
      window.alert(`Delete the ${recordsFor(cat.kind).length} record(s) in "${cat.label}" first.`);
      return;
    }
    if (!window.confirm(`Remove the "${cat.label}" category?`)) return;
    const next = customCategories.filter((c) => c.kind !== cat.kind);
    setCustomCategories(next);
    saveCustomPersonalCategories(next);
    if (activeKind === cat.kind) setActiveKind('home_loan');
  };

  const openForm = (kind: PersonalRecordKind, record?: PersonalRecord) => {
    setActiveKind(kind);
    setEditing(record ?? null);
    setForm(
      record
        ? {
            title: record.title,
            provider: record.provider,
            referenceNumber: record.referenceNumber,
            amount: String(record.amount || ''),
            periodicAmount: String(record.periodicAmount || ''),
            startDate: record.startDate,
            dueDate: record.dueDate,
            notes: record.notes ?? '',
          }
        : { ...EMPTY_FORM },
    );
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      kind: activeKind,
      title: form.title.trim() || categoryOf(activeKind).label,
      provider: form.provider.trim(),
      referenceNumber: form.referenceNumber.trim(),
      amount: Number(form.amount) || 0,
      periodicAmount: Number(form.periodicAmount) || 0,
      startDate: form.startDate,
      dueDate: form.dueDate,
      notes: form.notes.trim() || undefined,
    };
    if (editing) await updatePersonalRecord(editing.id, payload);
    else await addPersonalRecord(payload);
    setShowForm(false);
    setEditing(null);
  };

  /* ---------------------------------------------------------------- gates */

  if (!isOwner) {
    return (
      <div className="card card-pad empty-state py-16">
        <Lock className="h-9 w-9 text-ink-400" />
        <span className="text-sm font-semibold text-ink-700">Owner access only</span>
        <span className="text-xs text-ink-500">
          The Personal vault is restricted to the Owner / Super Admin account.
        </span>
      </div>
    );
  }

  if (locked || !personalPinSet) {
    return (
      <div className="mx-auto max-w-md space-y-6 pb-12 pt-6">
        <div className="card card-pad space-y-6">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-logo-700 text-white">
              {personalPinSet ? <KeyRound className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
            </span>
            <h2 className="mt-4 text-lg font-bold tracking-tight text-ink-900">
              {personalPinSet ? 'Personal vault locked' : 'Set your 4-digit PIN'}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              {personalPinSet
                ? 'Enter your private PIN to view home loan, insurance and term plan records.'
                : 'Create a 4-digit PIN to protect this private section. It is stored only in this browser.'}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="form-label block text-center" htmlFor="vault-pin">
                {personalPinSet ? 'Enter PIN' : 'New PIN'}
              </label>
              <input
                id="vault-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(e) => handlePinChange(e.target.value)}
                disabled={cooldown > 0}
                placeholder="••••"
                className="form-input text-center text-2xl tracking-[0.6em] font-mono"
              />
            </div>

            {!personalPinSet && (
              <div>
                <label className="form-label block text-center" htmlFor="vault-confirm">
                  Confirm PIN
                </label>
                <input
                  id="vault-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                    setPinError('');
                  }}
                  placeholder="••••"
                  className="form-input text-center text-2xl tracking-[0.6em] font-mono"
                />
              </div>
            )}

            {pinError && (
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-danger-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {pinError}
              </p>
            )}

            {personalPinSet && (
              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={cooldown > 0}
                    onClick={() => handlePinChange(pin + digit)}
                    className="btn btn-secondary h-11 text-base font-bold"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={cooldown > 0}
                  onClick={() => handlePinChange(pin.slice(0, -1))}
                  className="btn btn-secondary h-11"
                >
                  <Delete className="h-4 w-4 mx-auto" />
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0}
                  onClick={() => handlePinChange(pin + '0')}
                  className="btn btn-secondary h-11 text-base font-bold"
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0}
                  onClick={() => {
                    if (pin.length === 4 && !personalPinSet) submitPin(pin);
                  }}
                  className="btn btn-primary h-11"
                >
                  <CheckCircle2 className="h-4 w-4 mx-auto" />
                </button>
              </div>
            )}

            {!personalPinSet ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={() => submitPin(pin)}
              >
                <KeyRound className="h-4 w-4" />
                Set PIN &amp; unlock
              </button>
            ) : (
              cooldown === 0 && (
                <button type="button" className="btn btn-primary w-full" onClick={() => submitPin(pin)}>
                  <Unlock className="h-4 w-4" />
                  Unlock vault
                </button>
              )
            )}
          </div>

          <p className="border-t border-line pt-4 text-center text-[11px] leading-relaxed text-ink-400">
            This lock protects the vault view on this device only. It is not a replacement for your account password.
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- unlocked */

  const currentCategory = categoryOf(activeKind);
  const CurrentIcon = calcIcon(currentCategory.icon);
  const currentMeta = PERSONAL_TYPE_META[currentCategory.type];
  const visibleRecords = recordsFor(activeKind);

  return (
    <div className="space-y-6 pb-12">
      <div className="page-header">
        <div>
          <h2 className="page-title">Personal Vault</h2>
          <p className="page-subtitle">
            Private family finances — loans, insurance and anything else you add. Only visible to the Owner.
          </p>
        </div>
        <button
          onClick={() => {
            setUnlocked(false);
            setPin('');
          }}
          className="btn btn-secondary"
        >
          <Lock className="w-4 h-4" />
          Lock vault
        </button>
      </div>

      <div className="notice notice--success flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success-700" />
        <span className="text-xs font-semibold text-success-800">
          Verified — vault unlocked for {currentUser.name}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total loan outstanding</span>
          <div className="stat-value">{formatINR(totals.loans)}</div>
          <span className="stat-hint">Home + auto loans</span>
        </div>
        <div className="notice notice--success">
          <span className="stat-label text-success-800">Total cover</span>
          <div className="stat-value text-success-900">{formatINR(totals.cover)}</div>
          <span className="stat-hint text-success-700">Insurance &amp; term plans</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Annual premiums</span>
          <div className="stat-value">{formatINR(totals.annualPremium)}</div>
          <span className="stat-hint">Estimated from monthly premiums</span>
        </div>
        <div className="notice notice--warning">
          <span className="stat-label text-warning-800">Due this month</span>
          <div className="stat-value text-warning-900">{totals.upcoming}</div>
          <span className="stat-hint text-warning-700">Payments or renewals</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {categories.map((cat) => {
          const Icon = calcIcon(cat.icon);
          const items = recordsFor(cat.kind);
          const total = items.reduce((sum, r) => sum + (r.amount || 0), 0);
          const isActive = cat.kind === activeKind;
          const removable = !cat.builtin && customCategories.some((c) => c.kind === cat.kind);
          return (
            <div key={cat.kind} className="relative">
              <button
                type="button"
                onClick={() => setActiveKind(cat.kind)}
                className={`card card-pad h-full w-full text-left transition-colors ${
                  isActive ? 'ring-1 ring-inset ring-brand-600' : 'hover:bg-surface-muted'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`rounded-lg p-2 ${PERSONAL_TYPE_META[cat.type].tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {isActive && <CheckCircle2 className="h-4 w-4 text-brand-700" />}
                </div>
                <h3 className="mt-3 text-sm font-bold tracking-tight text-ink-900">{cat.label}</h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-500">{cat.description}</p>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-[11px] text-ink-500">{items.length} record{items.length === 1 ? '' : 's'}</span>
                  <span className="text-xs font-bold text-ink-900">{formatINR(total)}</span>
                </div>
              </button>
              {removable && (
                <button
                  type="button"
                  onClick={() => removeCategory(cat)}
                  className="icon-btn absolute right-2 top-2 !h-6 !w-6 bg-surface hover:text-danger-700"
                  title={`Remove ${cat.label}`}
                  aria-label={`Remove ${cat.label}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={openCategoryForm}
          className="flex min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong p-4 text-ink-600 transition-colors hover:border-logo-700 hover:text-ink-900"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold">New category</span>
          <span className="text-[11px] text-ink-500">Loan, insurance or anything similar</span>
        </button>
      </div>

      <div className="table-card">
        <div className="card-header">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900"><CurrentIcon className="h-4 w-4 text-ink-500" />{currentCategory.label}</h3>
            <p className="text-[11px] text-ink-500">{currentCategory.description}</p>
          </div>
          <button onClick={() => openForm(activeKind)} className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            Add record
          </button>
        </div>

        <div className="table-wrap">
          {visibleRecords.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-3.5 py-3">Particulars</th>
                  <th className="px-3.5 py-3">Provider / Ref</th>
                  <th className="px-3.5 py-3">{currentMeta.amountLabel}</th>
                  <th className="px-3.5 py-3">EMI / Premium</th>
                  <th className="px-3.5 py-3">Dates</th>
                  <th className="px-3.5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-700">
                {visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="px-3.5 py-3">
                      <div className="text-xs font-bold text-ink-900">{record.title}</div>
                      {record.notes && <div className="text-[11px] text-ink-500">{record.notes}</div>}
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      <div className="font-semibold text-ink-800">{record.provider || '—'}</div>
                      <div className="text-[11px] text-ink-500">{record.referenceNumber || 'No reference'}</div>
                    </td>
                    <td className="px-3.5 py-3 text-xs font-bold text-ink-900">{formatINR(record.amount)}</td>
                    <td className="px-3.5 py-3 text-xs font-semibold text-brand-700">
                      {record.periodicAmount ? `${formatINR(record.periodicAmount)}/mo` : '—'}
                    </td>
                    <td className="px-3.5 py-3 text-[11px] text-ink-600">
                      <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Start: {formatDateDDMMYYYY(record.startDate)}</span>
                      <span className="mt-0.5 flex items-center gap-1"><Landmark className="h-3 w-3" /> Due: {formatDateDDMMYYYY(record.dueDate)}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openForm(activeKind, record)} className="icon-btn" title="Edit record">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${record.title}"?`)) void deletePersonalRecord(record.id);
                          }}
                          className="icon-btn hover:text-danger-700"
                          title="Delete record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <CurrentIcon className="h-7 w-7 text-ink-400" />
              <span className="text-sm font-semibold text-ink-700">No {currentCategory.label.toLowerCase()} records yet</span>
              <span className="text-xs text-ink-500">Add your first record to start tracking it privately.</span>
              <button onClick={() => openForm(activeKind)} className="btn btn-primary btn-sm mt-2">
                <Plus className="h-3.5 w-3.5" />
                Add record
              </button>
            </div>
          )}
        </div>
      </div>

      {showCategoryForm && (
        <div className="modal-overlay" onClick={() => setShowCategoryForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">Personal vault</span>
                <h3 className="modal-title mt-0.5">New category</h3>
              </div>
              <button onClick={() => setShowCategoryForm(false)} className="icon-btn" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCategorySubmit}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="form-label" htmlFor="cat-name">Name</label>
                  <input
                    id="cat-name"
                    autoFocus
                    value={categoryForm.label}
                    onChange={(e) => {
                      setCategoryForm({ ...categoryForm, label: e.target.value });
                      setCategoryError('');
                    }}
                    placeholder="e.g. Education Loan, Bike Insurance"
                    maxLength={40}
                    className="form-input"
                  />
                </div>

                <div>
                  <span className="form-label">Type</span>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Category type">
                    {(Object.keys(PERSONAL_TYPE_META) as PersonalCategoryType[]).map((t) => {
                      const active = categoryForm.type === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setCategoryForm({ ...categoryForm, type: t })}
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            active
                              ? 'border-logo-700 bg-surface-muted'
                              : 'border-line hover:border-line-strong'
                          }`}
                        >
                          <span className="block text-xs font-bold text-ink-900">
                            {PERSONAL_TYPE_META[t].label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                            {PERSONAL_TYPE_META[t].hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="form-label">Icon</span>
                  <div className="grid grid-cols-6 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Category icon">
                    {Object.entries(CALC_ICONS).map(([key, { icon: Icon, label }]) => {
                      const active = categoryForm.icon === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          title={label}
                          aria-label={label}
                          onClick={() => setCategoryForm({ ...categoryForm, icon: key })}
                          className={`flex aspect-square items-center justify-center rounded-lg border transition-colors ${
                            active
                              ? 'border-logo-700 bg-logo-700 text-white'
                              : 'border-line text-ink-600 hover:border-line-strong hover:bg-surface-muted'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="form-label" htmlFor="cat-desc">Description (optional)</label>
                  <input
                    id="cat-desc"
                    value={categoryForm.description}
                    onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                    placeholder="What will you track here?"
                    maxLength={80}
                    className="form-input"
                  />
                </div>

                {categoryError && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-danger-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {categoryError}
                  </p>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowCategoryForm(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus className="h-4 w-4" />
                  Create category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">Personal vault</span>
                <h3 className="modal-title mt-0.5">
                  {editing ? 'Edit' : 'Add'} {currentCategory.label.toLowerCase()}
                </h3>
              </div>
              <button onClick={() => setShowForm(false)} className="icon-btn" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="form-label">Particulars / title</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. SBI Home Loan – Flat 402"
                    className="form-input"
                  />
                </div>
                <div className="form-grid">
                  <div>
                    <label className="form-label">Provider / bank</label>
                    <input
                      value={form.provider}
                      onChange={(e) => setForm({ ...form, provider: e.target.value })}
                      placeholder="e.g. HDFC Bank"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Loan / policy number</label>
                    <input
                      value={form.referenceNumber}
                      onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
                      placeholder="e.g. HDFCHL-88214"
                      className="form-input"
                    />
                  </div>
                </div>
                <div className="form-grid">
                  <div>
                    <label className="form-label">{currentMeta.amountLabel} (₹)</label>
                    <input
                      type="number"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">{currentCategory.type === 'loan' ? 'Monthly EMI (₹)' : 'Monthly premium (₹)'}</label>
                    <input
                      type="number"
                      value={form.periodicAmount}
                      onChange={(e) => setForm({ ...form, periodicAmount: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>
                <div className="form-grid">
                  <div>
                    <label className="form-label">Start date</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Next due / expiry</label>
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">Private notes</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional details visible only here"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Save record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
