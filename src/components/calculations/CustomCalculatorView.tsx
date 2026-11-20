import React, { useMemo, useState } from 'react';
import { Pencil, Trash2, Save, ListChecks, Hash, Sigma } from 'lucide-react';
import type { CustomCalcEntry, CustomCalculator } from '../../data/customCalculators';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import { KpiCard, KpiAccent, SectionHeader, UnitValue, calcIcon, newId } from './calcUi';
import { evaluateFormula } from './formula';

/** Entry values are stored by field id so renaming a field keeps old entries intact. */
export function computeOutputs(
  calc: CustomCalculator,
  valuesById: Record<string, number>,
): { results: Record<string, number>; errors: Record<string, string> } {
  const scope: Record<string, number> = {};
  for (const f of calc.fields) scope[f.key] = Number(valuesById[f.id]) || 0;
  const results: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const o of calc.outputs) {
    try {
      results[o.id] = evaluateFormula(o.formula, scope);
    } catch (e) {
      results[o.id] = 0;
      errors[o.id] = e instanceof Error ? e.message : 'Invalid formula';
    }
    scope[o.key] = results[o.id];
  }
  return { results, errors };
}

const ACCENTS: KpiAccent[] = ['brand', 'success', 'warning'];
const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  calc: CustomCalculator;
  onChange: (calc: CustomCalculator) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const CustomCalculatorView: React.FC<Props> = ({ calc, onChange, onEdit, onDelete }) => {
  const Icon = calcIcon(calc.icon);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);

  const numericInputs = useMemo(
    () => Object.fromEntries(calc.fields.map((f) => [f.id, Number(inputs[f.id]) || 0])),
    [calc.fields, inputs],
  );
  const live = computeOutputs(calc, numericInputs);

  const entryResults = useMemo(
    () => calc.entries.map((e) => ({ entry: e, ...computeOutputs(calc, e.values) })),
    [calc],
  );

  // Percentages are averaged — summing margins means nothing.
  const totals = calc.outputs.map((o) => {
    const sum = entryResults.reduce((s, r) => s + (r.results[o.id] ?? 0), 0);
    const isAvg = o.unit === 'percent';
    return {
      output: o,
      isAvg,
      total: isAvg ? (entryResults.length ? sum / entryResults.length : 0) : sum,
    };
  });

  const hasInput = calc.fields.some((f) => (inputs[f.id] ?? '').trim() !== '');

  const saveEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasInput) return;
    const entry: CustomCalcEntry = {
      id: newId(),
      title: title.trim() || `Entry ${calc.entries.length + 1}`,
      date: date || today(),
      values: numericInputs,
    };
    onChange({ ...calc, entries: [entry, ...calc.entries] });
    setInputs({});
    setTitle('');
  };

  const removeEntry = (id: string) =>
    onChange({ ...calc, entries: calc.entries.filter((e) => e.id !== id) });

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <div className="page-header sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="section-icon mt-0.5 h-10 w-10">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="page-title !mt-0 truncate">{calc.name}</h2>
            <p className="page-subtitle">
              {calc.description || `${calc.fields.length} inputs · ${calc.outputs.length} results`}
            </p>
          </div>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost hover:text-danger-600"
            onClick={() => {
              if (window.confirm(`Delete "${calc.name}" and all ${calc.entries.length} saved entries?`)) onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Saved Entries"
          value={calc.entries.length}
          hint={calc.entries[0] ? `Last on ${formatDateDDMMYYYY(calc.entries[0].date)}` : 'Nothing saved yet'}
          icon={Hash}
          onClick={() => scrollTo('calc-entries')}
        />
        {totals.slice(0, 3).map(({ output, total, isAvg }, i) => (
          <KpiCard
            key={output.id}
            label={`${isAvg ? 'Avg' : 'Total'} ${output.label}`}
            value={<UnitValue value={total} unit={output.unit} size="xl" />}
            hint={`${isAvg ? 'Average' : 'Sum'} across ${calc.entries.length} entries`}
            icon={Sigma}
            accent={ACCENTS[i]}
            onClick={() => scrollTo('calc-entries')}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <form onSubmit={saveEntry} className="card card-pad">
          <SectionHeader title="Calculate" icon={Icon} />
          <div className="space-y-3">
            {calc.fields.map((f) => (
              <div key={f.id}>
                <label className="form-label" htmlFor={`in-${f.id}`}>
                  {f.label}
                </label>
                <input
                  id={`in-${f.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="form-input"
                  value={inputs[f.id] ?? ''}
                  placeholder="0"
                  onChange={(e) => setInputs((p) => ({ ...p, [f.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface-muted p-3">
            {calc.outputs.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-600">{o.label}</span>
                {live.errors[o.id] ? (
                  <span className="text-xs text-danger-600">{live.errors[o.id]}</span>
                ) : (
                  <UnitValue value={live.results[o.id] ?? 0} unit={o.unit} className="font-bold text-ink-900" />
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <input
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Entry name"
              aria-label="Entry name"
            />
            <input
              type="date"
              className="form-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Entry date"
            />
          </div>
          <button type="submit" className="btn btn-primary mt-3 w-full" disabled={!hasInput}>
            <Save className="h-4 w-4" /> Save entry
          </button>
        </form>

        <div id="calc-entries" className="card card-pad lg:col-span-2">
          <SectionHeader
            title="Saved Entries"
            icon={ListChecks}
            action={<span className="shrink-0 text-xs text-ink-500">{calc.entries.length} entries</span>}
          />
          {calc.entries.length === 0 ? (
            <div className="empty-state">
              <ListChecks className="h-6 w-6 text-ink-300" />
              <p className="text-sm">Fill the calculator and save an entry to build your totals.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Date</th>
                    {calc.fields.map((f) => (
                      <th key={f.id} className="text-right">{f.label}</th>
                    ))}
                    {calc.outputs.map((o) => (
                      <th key={o.id} className="text-right text-ink-900">{o.label}</th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {entryResults.map(({ entry, results }) => (
                    <tr key={entry.id}>
                      <td className="font-semibold text-ink-900">{entry.title}</td>
                      <td>{formatDateDDMMYYYY(entry.date)}</td>
                      {calc.fields.map((f) => (
                        <td key={f.id} className="text-right">
                          <UnitValue value={entry.values[f.id] ?? 0} unit={f.unit} size="xs" />
                        </td>
                      ))}
                      {calc.outputs.map((o) => (
                        <td key={o.id} className="text-right font-semibold text-ink-900">
                          <UnitValue value={results[o.id] ?? 0} unit={o.unit} size="xs" />
                        </td>
                      ))}
                      <td className="text-right">
                        <button
                          type="button"
                          className="icon-btn hover:text-danger-600"
                          aria-label={`Delete ${entry.title}`}
                          onClick={() => removeEntry(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-ink-900">
                    <td colSpan={2 + calc.fields.length}>Total</td>
                    {totals.map(({ output, total }) => (
                      <td key={output.id} className="text-right">
                        <UnitValue value={total} unit={output.unit} size="xs" />
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
