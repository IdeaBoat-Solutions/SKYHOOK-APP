import React from 'react';
import {
  ArrowRight,
  Calculator,
  Fuel,
  Truck,
  Wrench,
  Hammer,
  Gauge,
  Clock,
  IndianRupee,
  Wallet,
  PiggyBank,
  Percent,
  TrendingUp,
  Receipt,
  Construction,
  HardHat,
  Package,
  Route,
  Weight,
  Users,
  Zap,
  Landmark,
  Sigma,
  Home,
  HeartPulse,
  Shield,
  CarFront,
  Car,
  Bike,
  GraduationCap,
  Plane,
  Stethoscope,
  Gem,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { Currency } from '../common/Currency';
import type { CalcUnit } from '../../data/customCalculators';

/** Icons a user can pick for their own calculator. */
export const CALC_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  calculator: { icon: Calculator, label: 'Calculator' },
  sigma: { icon: Sigma, label: 'Total' },
  fuel: { icon: Fuel, label: 'Fuel' },
  truck: { icon: Truck, label: 'Transport' },
  construction: { icon: Construction, label: 'Crane' },
  wrench: { icon: Wrench, label: 'Service' },
  hammer: { icon: Hammer, label: 'Repair' },
  gauge: { icon: Gauge, label: 'Meter' },
  clock: { icon: Clock, label: 'Hours' },
  rupee: { icon: IndianRupee, label: 'Rupee' },
  wallet: { icon: Wallet, label: 'Wallet' },
  piggy: { icon: PiggyBank, label: 'Savings' },
  percent: { icon: Percent, label: 'Percent' },
  trend: { icon: TrendingUp, label: 'Profit' },
  receipt: { icon: Receipt, label: 'Bill' },
  hardhat: { icon: HardHat, label: 'Labour' },
  package: { icon: Package, label: 'Material' },
  route: { icon: Route, label: 'Distance' },
  weight: { icon: Weight, label: 'Weight' },
  users: { icon: Users, label: 'People' },
  zap: { icon: Zap, label: 'Power' },
  bank: { icon: Landmark, label: 'Bank' },
  home: { icon: Home, label: 'Home' },
  heartpulse: { icon: HeartPulse, label: 'Health' },
  shield: { icon: Shield, label: 'Cover' },
  carfront: { icon: CarFront, label: 'Vehicle' },
  car: { icon: Car, label: 'Car' },
  bike: { icon: Bike, label: 'Bike' },
  education: { icon: GraduationCap, label: 'Education' },
  travel: { icon: Plane, label: 'Travel' },
  medical: { icon: Stethoscope, label: 'Medical' },
  gem: { icon: Gem, label: 'Gold' },
  building: { icon: Building2, label: 'Property' },
};

export const calcIcon = (key: string): LucideIcon => CALC_ICONS[key]?.icon ?? Calculator;

export const UNIT_LABELS: Record<CalcUnit, string> = {
  currency: '₹ Amount',
  number: 'Number',
  percent: '% Percent',
  hours: 'Hours',
  litres: 'Litres',
  km: 'Kilometres',
  tonnes: 'Tonnes',
};

const UNIT_SUFFIX: Partial<Record<CalcUnit, string>> = {
  percent: '%',
  hours: 'hrs',
  litres: 'L',
  km: 'km',
  tonnes: 'T',
};

export const UnitValue: React.FC<{
  value: number;
  unit: CalcUnit;
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  className?: string;
}> = ({ value, unit, size = 'sm', className = '' }) => {
  if (unit === 'currency') return <Currency value={value} size={size} className={className} />;
  const formatted = (Math.round(value * 100) / 100).toLocaleString('en-IN');
  const suffix = UNIT_SUFFIX[unit];
  return (
    <span className={className}>
      {formatted}
      {suffix && <span className="ml-1 text-[0.7em] font-medium text-ink-500">{suffix}</span>}
    </span>
  );
};

export type KpiAccent = 'brand' | 'success' | 'warning' | 'danger';

const ACCENT: Record<KpiAccent, { tone: string; bar: string }> = {
  brand: { tone: 'tone-brand', bar: 'bg-brand-600' },
  success: { tone: 'tone-success', bar: 'bg-success-600' },
  warning: { tone: 'tone-warning', bar: 'bg-warning-600' },
  danger: { tone: 'tone-danger', bar: 'bg-danger-600' },
};

export const KpiCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ElementType;
  accent?: KpiAccent;
  onClick?: () => void;
}> = ({ label, value, hint, icon: Icon, accent = 'brand', onClick }) => {
  const styles = ACCENT[accent];
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick();
      }}
      className={`kpi-card relative min-w-0 overflow-hidden transition-colors ${
        interactive
          ? 'cursor-pointer hover:bg-surface-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500'
          : ''
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 ${styles.bar}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <span className="stat-label">{label}</span>
        <span className={`kpi-card__icon shrink-0 ${styles.tone}`}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
      <div className="kpi-card__value min-w-0 truncate">{value}</div>
      <div className="kpi-card__foot">
        <span className="stat-hint truncate">{hint}</span>
        {interactive && (
          <span className={`kpi-card__icon shrink-0 ${styles.tone}`}>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        )}
      </div>
    </div>
  );
};

export const SectionHeader: React.FC<{
  title: string;
  icon: React.ElementType;
  action?: React.ReactNode;
}> = ({ title, icon: Icon, action }) => (
  <div className="-mx-[1.125rem] mb-4 flex items-center justify-between gap-3 border-b border-line px-[1.125rem] pb-3">
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="section-icon shrink-0">
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="section-title truncate text-sm sm:text-base">{title}</h3>
    </div>
    {action}
  </div>
);

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
