import React, { useMemo, useState } from 'react';
import { X, Plus, Trash2, Sparkles, AlertCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type {
  CalcUnit,
  CustomCalcField,
  CustomCalcOutput,
  CustomCalculator,
} from '../../data/customCalculators';
import { CALC_ICONS, UNIT_LABELS, calcIcon, newId } from './calcUi';
import { checkFormula, toKey } from './formula';

type DraftField = { id: string; label: string; unit: CalcUnit };
type DraftOutput = { id: string; label: string; formula: string; unit: CalcUnit };

interface Template {
  name: string;
  description: string;
  icon: string;
  fields: Omit<DraftField, 'id'>[];
  outputs: Omit<DraftOutput, 'id'>[];
}

const TEMPLATES: Template[] = [
  {
    name: 'Blank calculator',
    description: '',
    icon: 'calculator',
    fields: [{ label: 'Quantity', unit: 'number' }, { label: 'Rate', unit: 'currency' }],
    outputs: [{ label: 'Total', formula: 'quantity * rate', unit: 'currency' }],
  },
  {
    name: 'Diesel Cost',
    description: 'Fuel consumed per machine and its cost',
    icon: 'fuel',
    fields: [
      { label: 'Litres', unit: 'litres' },
      { label: 'Rate per litre', unit: 'currency' },
      { label: 'Hours worked', unit: 'hours' },
    ],
    outputs: [
      { label: 'Diesel cost', formula: 'litres * rate_per_litre', unit: 'currency' },
      { label: 'Litres per hour', formula: 'litres / hours_worked', unit: 'litres' },
    ],
  },
  {
    name: 'Crane Hire Billing',
    description: 'Hire charges with mobilisation and GST',
    icon: 'construction',
    fields: [
      { label: 'Hours', unit: 'hours' },
      { label: 'Hourly rate', unit: 'currency' },
      { label: 'Mobilisation', unit: 'currency' },
      { label: 'GST', unit: 'percent' },
    ],
    outputs: [
      { label: 'Base amount', formula: 'hours * hourly_rate + mobilisation', unit: 'currency' },
      { label: 'GST amount', formula: 'base_amount * gst / 100', unit: 'currency' },
      { label: 'Invoice total', formula: 'base_amount + gst_amount', unit: 'currency' },
    ],
  },
  {
    name: 'Job Profit',
    description: 'Revenue minus operating costs per job',
    icon: 'trend',
    fields: [
      { label: 'Revenue', unit: 'currency' },
      { label: 'Diesel', unit: 'currency' },
      { label: 'Operator wages', unit: 'currency' },
      { label: 'Other costs', unit: 'currency' },
    ],
    outputs: [
      { label: 'Total cost', formula: 'diesel + operator_wages + other_costs', unit: 'currency' },
      { label: 'Profit', formula: 'revenue - total_cost', unit: 'currency' },
      { label: 'Margin', formula: 'profit / revenue * 100', unit: 'percent' },
    ],
  },
];

const UNITS = Object.keys(UNIT_LABELS) as CalcUnit[];

const withIds = <T,>(items: T[]) => items.map((i) => ({ ...i, id: newId() }));

interface Props {
  initial?: CustomCalculator;
  onClose: () => void;
  onSave: (calc: CustomCalculator) => void;
}

/** Lets an owner/manager design their own calculator: icon, inputs, formulas. */
export const CalculatorBuilderModal: React.FC<Props> = ({ initial, onClose, onSave }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'calculator');
  const [fields, setFields] = useState<DraftField[]>(
    initial?.fields.map(({ id, label, unit }) => ({ id, label, unit })) ?? withIds(TEMPLATES[0].fields),
  );
  const [outputs, setOutputs] = useState<DraftOutput[]>(
    initial?.outputs.map(({ id, label, formula, unit }) => ({ id, label, formula, unit })) ??
      withIds(TEMPLATES[0].outputs),
  );
  const [submitted, setSubmitted] = useState(false);

  const applyTemplate = (t: Template) => {
    setName(t.name === 'Blank calculator' ? '' : t.name);
    setDescription(t.description);
    setIcon(t.icon);
    setFields(withIds(t.fields));
    setOutputs(withIds(t.outputs));
  };

  const fieldKeys = fields.map((f) => toKey(f.label));

  // Each output may use fields and any output defined above it.
  const outputErrors = useMemo(() => {
    const available = [...fieldKeys];
    return outputs.map((o) => {
      const err = o.formula.trim() ? checkFormula(o.formula, available) : 'Formula is required';
      available.push(toKey(o.label));
      return err;
    });
  }, [outputs, fieldKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const allKeys = [...fieldKeys, ...outputs.map((o) => toKey(o.label))];
  const duplicateKeys = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);

  const errors: string[] = [];
  if (!name.trim()) errors.push('Give your calculator a name.');
  if (fields.length === 0) errors.push('Add at least one input field.');
  if (outputs.length === 0) errors.push('Add at least one result.');
  if (fields.some((f) => !f.label.trim()) || outputs.some((o) => !o.label.trim()))
    errors.push('Every input and result needs a label.');
  if (duplicateKeys.length) errors.push(`Labels must be unique (repeated: ${[...new Set(duplicateKeys)].join(', ')}).`);
  if (outputErrors.some(Boolean)) errors.push('Fix the highlighted formulas.');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.length) return;
    const savedFields: CustomCalcField[] = fields.map((f) => ({
      id: f.id,
      key: toKey(f.label),
      label: f.label.trim(),
      unit: f.unit,
    }));
    const savedOutputs: CustomCalcOutput[] = outputs.map((o) => ({
      id: o.id,
      key: toKey(o.label),
      label: o.label.trim(),
      formula: o.formula.trim(),
      unit: o.unit,
    }));
    onSave({
      id: initial?.id ?? newId(),
      name: name.trim(),
      description: description.trim(),
      icon,
      fields: savedFields,
      outputs: savedOutputs,
      entries: initial?.entries ?? [],
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  };

  const insertKey = (outputId: string, key: string) =>
    setOutputs((prev) =>
      prev.map((o) =>
        o.id === outputId ? { ...o, formula: `${o.formula.trimEnd()}${o.formula.trim() ? ' ' : ''}${key}` } : o,
      ),
    );

  const PreviewIcon = calcIcon(icon);

  return (
    <div className="modal-overlay">
      <form onSubmit={handleSave} className="modal-panel modal-panel-wide">
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <span className="section-icon">
              <PreviewIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="modal-title">{initial ? 'Edit calculator' : 'Add a calculator'}</h2>
              <p className="text-xs text-ink-500">
                Build your own calculation: pick an icon, define inputs and write formulas.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body max-h-[70vh] space-y-6 overflow-y-auto">
          {!initial && (
            <div>
              <span className="form-label flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Start from a template
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TEMPLATES.map((t) => {
                  const TIcon = calcIcon(t.icon);
                  return (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-left text-xs font-semibold text-ink-800 transition-colors hover:border-line-strong hover:bg-surface-muted"
                    >
                      <TIcon className="h-4 w-4 shrink-0 text-ink-500" />
                      <span className="truncate">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="calc-name">Calculator name</label>
              <input
                id="calc-name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Diesel Cost"
                maxLength={60}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="calc-desc">Description (optional)</label>
              <input
                id="calc-desc"
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this calculate?"
                maxLength={140}
              />
            </div>
          </div>

          <div>
            <span className="form-label">Icon</span>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" aria-label="Calculator icon">
              {Object.entries(CALC_ICONS).map(([key, { icon: Icon, label }]) => {
                const active = key === icon;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={label}
                    aria-label={label}
                    onClick={() => setIcon(key)}
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

          {/* Inputs */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="form-label !mb-0">Inputs</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setFields((p) => [...p, { id: newId(), label: '', unit: 'number' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add input
              </button>
            </div>
            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div key={f.id} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
                  <div className="min-w-0">
                    <input
                      className="form-input"
                      value={f.label}
                      placeholder={`Input ${idx + 1} label`}
                      onChange={(e) =>
                        setFields((p) => p.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    {f.label.trim() && (
                      <span className="mt-0.5 block font-mono text-[10px] text-ink-400">{toKey(f.label)}</span>
                    )}
                  </div>
                  <Select
                    value={f.unit}
                    onValueChange={(v) =>
                      setFields((p) => p.map((x) => (x.id === f.id ? { ...x, unit: v as CalcUnit } : x)))
                    }
                  >
                    <SelectTrigger className="form-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{UNIT_LABELS[u]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="icon-btn hover:text-danger-600"
                    aria-label="Remove input"
                    onClick={() => setFields((p) => p.filter((x) => x.id !== f.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Outputs */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="form-label !mb-0">Results (formulas)</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setOutputs((p) => [...p, { id: newId(), label: '', formula: '', unit: 'currency' }])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add result
              </button>
            </div>
            <p className="mb-3 text-[11px] text-ink-500">
              Use input names with <code>+ − × ÷</code> as <code>+ - * /</code>, brackets, and{' '}
              <code>min() max() round()</code>. A result can use results listed above it.
            </p>
            <div className="space-y-3">
              {outputs.map((o, idx) => {
                const usable = [...fieldKeys, ...outputs.slice(0, idx).map((x) => toKey(x.label))].filter(Boolean);
                const err = submitted || o.formula.trim() ? outputErrors[idx] : null;
                return (
                  <div key={o.id} className="rounded-lg border border-line p-3">
                    <div className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
                      <input
                        className="form-input"
                        value={o.label}
                        placeholder={`Result ${idx + 1} label`}
                        onChange={(e) =>
                          setOutputs((p) => p.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))
                        }
                      />
                      <Select
                        value={o.unit}
                        onValueChange={(v) =>
                          setOutputs((p) => p.map((x) => (x.id === o.id ? { ...x, unit: v as CalcUnit } : x)))
                        }
                      >
                        <SelectTrigger className="form-input">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS.map((u) => (
                            <SelectItem key={u} value={u}>{UNIT_LABELS[u]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        className="icon-btn hover:text-danger-600"
                        aria-label="Remove result"
                        onClick={() => setOutputs((p) => p.filter((x) => x.id !== o.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <input
                      className={`form-input mt-2 font-mono text-xs ${err ? '!border-danger-600' : ''}`}
                      value={o.formula}
                      placeholder="e.g. quantity * rate"
                      onChange={(e) =>
                        setOutputs((p) => p.map((x) => (x.id === o.id ? { ...x, formula: e.target.value } : x)))
                      }
                      aria-invalid={Boolean(err)}
                    />
                    {err && <p className="mt-1 text-[11px] text-danger-600">{err}</p>}
                    {usable.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {usable.map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => insertKey(o.id, k)}
                            className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-600 hover:border-line-strong hover:text-ink-900"
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {submitted && errors.length > 0 && (
            <div className="alert-banner text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errors[0]}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {initial ? 'Save changes' : 'Create calculator'}
          </button>
        </div>
      </form>
    </div>
  );
};
