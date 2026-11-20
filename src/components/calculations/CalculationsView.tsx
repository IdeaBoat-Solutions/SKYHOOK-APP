import React, { useEffect, useState } from 'react';
import { Plus, Truck, FileText } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import {
  CustomCalculator,
  getCustomCalculators,
  saveCustomCalculators,
} from '../../data/customCalculators';
import { EmiView } from '../emi/EmiView';
import { TotalMachinesView } from './TotalMachinesView';
import { CustomCalculatorView } from './CustomCalculatorView';
import { CalculatorBuilderModal } from './CalculatorBuilderModal';
import { calcIcon } from './calcUi';

export type CalcTab = 'emi' | 'total_machines' | `custom:${string}`;

const TAB_KEY = 'skyhook:calculations:tab';

interface Props {
  /** Forces a tab, e.g. when an EMI alert deep-links here. */
  initialTab?: CalcTab;
}

/** Calculations module: Machine EMI, fleet totals and user-built calculators. */
export const CalculationsView: React.FC<Props> = ({ initialTab }) => {
  const { currentUser } = useSkyhook();
  const isManager = currentUser.role === 'manager';

  const [calculators, setCalculators] = useState<CustomCalculator[]>(getCustomCalculators);
  const [builder, setBuilder] = useState<{ open: boolean; editing?: CustomCalculator }>({ open: false });
  const [tab, setTab] = useState<CalcTab>(() => {
    if (initialTab) return initialTab;
    try {
      const saved = localStorage.getItem(TAB_KEY) as CalcTab | null;
      if (saved) return saved;
    } catch {
      /* ignore */
    }
    return isManager ? 'total_machines' : 'emi';
  });

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Fall back when the selected tab is not allowed or no longer exists.
  const customId = tab.startsWith('custom:') ? tab.slice(7) : null;
  const activeCustom = customId ? calculators.find((c) => c.id === customId) : undefined;
  const resolvedTab: CalcTab =
    (tab === 'emi' && isManager) || (customId && !activeCustom) ? 'total_machines' : tab;

  const selectTab = (next: CalcTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const persist = (next: CustomCalculator[]) => {
    setCalculators(next);
    saveCustomCalculators(next);
  };

  const upsert = (calc: CustomCalculator) => {
    const exists = calculators.some((c) => c.id === calc.id);
    persist(exists ? calculators.map((c) => (c.id === calc.id ? calc : c)) : [...calculators, calc]);
    setBuilder({ open: false });
    selectTab(`custom:${calc.id}`);
  };

  const remove = (id: string) => {
    persist(calculators.filter((c) => c.id !== id));
    selectTab('total_machines');
  };

  const tabs: { id: CalcTab; label: string; icon: React.ElementType }[] = [
    ...(isManager ? [] : [{ id: 'emi' as CalcTab, label: 'Machine EMI', icon: FileText }]),
    { id: 'total_machines', label: 'Total Machines', icon: Truck },
    ...calculators.map((c) => ({
      id: `custom:${c.id}` as CalcTab,
      label: c.name,
      icon: calcIcon(c.icon),
    })),
  ];

  return (
    <div className="space-y-5 pb-12">
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Calculations">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = resolvedTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                active
                  ? 'border-ink-900 bg-ink-900 text-white'
                  : 'border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-[12rem] truncate">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setBuilder({ open: true })}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3.5 py-2 text-[13px] font-semibold text-ink-600 transition-colors hover:border-ink-900 hover:text-ink-900"
        >
          <Plus className="h-4 w-4" />
          Add calculator
        </button>
      </div>

      {resolvedTab === 'emi' && <EmiView />}
      {resolvedTab === 'total_machines' && <TotalMachinesView />}
      {activeCustom && resolvedTab === `custom:${activeCustom.id}` && (
        <CustomCalculatorView
          key={activeCustom.id}
          calc={activeCustom}
          onChange={upsert}
          onEdit={() => setBuilder({ open: true, editing: activeCustom })}
          onDelete={() => remove(activeCustom.id)}
        />
      )}

      {builder.open && (
        <CalculatorBuilderModal
          initial={builder.editing}
          onClose={() => setBuilder({ open: false })}
          onSave={upsert}
        />
      )}
    </div>
  );
};
