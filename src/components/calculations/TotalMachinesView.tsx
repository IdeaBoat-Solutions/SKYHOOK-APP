import React, { useMemo, useState } from 'react';
import { Truck, IndianRupee, Weight, Wrench, PieChart, ListChecks, Activity } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { AssetStatus, MachineAsset } from '../../types';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Currency } from '../common/Currency';
import { KpiCard, SectionHeader } from './calcUi';

const STATUS_META: Record<AssetStatus, { label: string; badge: string }> = {
  available: { label: 'Available', badge: 'badge-success' },
  assigned: { label: 'Assigned', badge: 'badge-brand' },
  under_maintenance: { label: 'Maintenance', badge: 'badge-warning' },
  inactive: { label: 'Inactive', badge: 'badge-neutral' },
  sold: { label: 'Sold', badge: 'badge-neutral' },
};

type StatusFilter = 'all' | AssetStatus;

const ageInYears = (date: string) => {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / (365.25 * 24 * 3600 * 1000));
};

/** Fleet-wide totals: count, value, capacity and EMI exposure per machine. */
export const TotalMachinesView: React.FC = () => {
  const { machines, emiLoans, projects, currentUser } = useSkyhook();
  const isOwner = currentUser.role !== 'manager';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Sold machines are history, not fleet.
  const fleet = useMemo(() => machines.filter((m) => m.status !== 'sold'), [machines]);

  const outstandingByAsset = useMemo(() => {
    const map: Record<string, number> = {};
    for (const loan of emiLoans) {
      map[loan.assetId] = (map[loan.assetId] ?? 0) + loan.emiAmount * loan.remainingInstallments;
    }
    return map;
  }, [emiLoans]);

  const totalValue = fleet.reduce((s, m) => s + (m.purchaseCost || 0), 0);
  const totalTonnage = fleet.reduce((s, m) => s + (m.tonnageCapacity || 0), 0);
  const countBy = (status: AssetStatus) => fleet.filter((m) => m.status === status).length;
  const assigned = countBy('assigned');
  const available = countBy('available');
  const maintenance = countBy('under_maintenance');
  const utilisation = fleet.length ? Math.round((assigned / fleet.length) * 100) : 0;
  const totalEmi = fleet.reduce((s, m) => s + (outstandingByAsset[m.assetId] ?? 0), 0);

  const byType = useMemo(() => {
    const groups = new Map<string, { count: number; tonnage: number; value: number }>();
    for (const m of fleet) {
      const g = groups.get(m.machineType) ?? { count: 0, tonnage: 0, value: 0 };
      g.count += 1;
      g.tonnage += m.tonnageCapacity || 0;
      g.value += m.purchaseCost || 0;
      groups.set(m.machineType, g);
    }
    return [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [fleet]);

  const rows: MachineAsset[] = (statusFilter === 'all'
    ? machines
    : machines.filter((m) => m.status === statusFilter)
  ).slice().sort((a, b) => a.assetId.localeCompare(b.assetId));

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title !mt-0">Total Machines</h2>
          <p className="page-subtitle">
            Fleet count, investment, lifting capacity and utilisation across every crane.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Machines"
          value={fleet.length}
          hint={`${assigned} assigned · ${available} available`}
          icon={Truck}
          onClick={() => scrollTo('fleet-register')}
        />
        <KpiCard
          label="Fleet Value"
          value={<Currency value={totalValue} size="xl" />}
          hint={isOwner ? `EMI outstanding ₹${Math.round(totalEmi).toLocaleString('en-IN')}` : 'Total purchase cost'}
          icon={IndianRupee}
          onClick={() => scrollTo('fleet-types')}
        />
        <KpiCard
          label="Total Capacity"
          value={
            <span>
              {totalTonnage.toLocaleString('en-IN')}
              <span className="ml-1 text-base font-medium text-ink-500">T</span>
            </span>
          }
          hint={`Avg ${fleet.length ? Math.round(totalTonnage / fleet.length) : 0} T per machine`}
          icon={Weight}
          accent="success"
          onClick={() => scrollTo('fleet-types')}
        />
        <KpiCard
          label="Under Maintenance"
          value={
            <span className={maintenance > 0 ? 'text-danger-600' : 'text-success-600'}>
              {maintenance}
            </span>
          }
          hint={`${utilisation}% fleet utilisation`}
          icon={Wrench}
          accent="danger"
          onClick={() => {
            setStatusFilter('under_maintenance');
            scrollTo('fleet-register');
          }}
        />
      </div>

      <div id="fleet-types" className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card card-pad">
          <SectionHeader
            title="Fleet by Status"
            icon={Activity}
            action={<span className="shrink-0 text-xs text-ink-500">{fleet.length} machines</span>}
          />
          {fleet.length === 0 ? (
            <div className="empty-state">
              <Truck className="h-6 w-6 text-ink-300" />
              <p className="text-sm">No machines in the asset master yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(['assigned', 'available', 'under_maintenance', 'inactive'] as AssetStatus[]).map((s) => {
                const n = countBy(s);
                const pct = fleet.length ? (n / fleet.length) * 100 : 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusFilter(s);
                      scrollTo('fleet-register');
                    }}
                    className="block w-full rounded-lg border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-muted"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className={`badge ${STATUS_META[s].badge}`}>{STATUS_META[s].label}</span>
                      <span className="font-semibold text-ink-900">
                        {n} <span className="font-normal text-ink-500">({Math.round(pct)}%)</span>
                      </span>
                    </div>
                    <div className="progress mt-2">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card card-pad lg:col-span-2">
          <SectionHeader
            title="Fleet by Machine Type"
            icon={PieChart}
            action={<span className="shrink-0 text-xs text-ink-500">{byType.length} {byType.length === 1 ? 'type' : 'types'}</span>}
          />
          {byType.length === 0 ? (
            <div className="empty-state">
              <PieChart className="h-6 w-6 text-ink-300" />
              <p className="text-sm">Add machines to see the type breakdown.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Machine type</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Capacity</th>
                    <th className="text-right">Value</th>
                    <th className="w-32">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map(([type, g]) => {
                    const share = fleet.length ? (g.count / fleet.length) * 100 : 0;
                    return (
                      <tr key={type}>
                        <td className="font-semibold text-ink-900">{type}</td>
                        <td className="text-right">{g.count}</td>
                        <td className="text-right">{g.tonnage.toLocaleString('en-IN')} T</td>
                        <td className="text-right">
                          <Currency value={g.value} size="xs" />
                        </td>
                        <td>
                          <div className="progress">
                            <span style={{ width: `${share}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-ink-900">
                    <td>Total</td>
                    <td className="text-right">{fleet.length}</td>
                    <td className="text-right">{totalTonnage.toLocaleString('en-IN')} T</td>
                    <td className="text-right">
                      <Currency value={totalValue} size="xs" />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      <div id="fleet-register" className="card card-pad">
        <SectionHeader
          title="Machine Register"
          icon={ListChecks}
          action={
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="form-input w-auto px-3 py-1.5 text-xs font-semibold text-ink-700">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(STATUS_META) as AssetStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {rows.length === 0 ? (
          <div className="empty-state">
            <ListChecks className="h-6 w-6 text-ink-300" />
            <p className="text-sm">No machines match this status.</p>
          </div>
        ) : (
          <>
          <div className="space-y-2.5 md:hidden">
            {rows.map((m) => (
              <div key={m.id} className="rounded-lg border border-line p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink-900">{m.assetId}</div>
                    <div className="truncate text-xs text-ink-600">{m.make} {m.model} · {m.machineType}</div>
                  </div>
                  <span className={`badge shrink-0 ${STATUS_META[m.status]?.badge ?? 'badge-neutral'}`}>
                    {STATUS_META[m.status]?.label ?? m.status}
                  </span>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div><dt className="text-ink-500">Capacity</dt><dd className="font-semibold text-ink-900">{m.tonnageCapacity} T</dd></div>
                  <div><dt className="text-ink-500">Cost</dt><dd className="font-semibold text-ink-900"><Currency value={m.purchaseCost || 0} size="xs" /></dd></div>
                  <div><dt className="text-ink-500">Purchased</dt><dd className="font-semibold text-ink-900">{m.purchaseDate ? `${formatDateDDMMYYYY(m.purchaseDate)} (${ageInYears(m.purchaseDate).toFixed(1)} yrs)` : '-'}</dd></div>
                  <div><dt className="text-ink-500">Deployment</dt><dd className="truncate font-semibold text-ink-900">{projectName(m.currentProjectId) ?? '-'}</dd></div>
                  {isOwner && outstandingByAsset[m.assetId] ? (
                    <div className="col-span-2"><dt className="text-ink-500">EMI outstanding</dt><dd className="font-semibold text-ink-900"><Currency value={outstandingByAsset[m.assetId]} size="xs" /></dd></div>
                  ) : null}
                </dl>
              </div>
            ))}
          </div>
          <div className="table-wrap hidden md:block">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Make / model</th>
                  <th className="text-right">Capacity</th>
                  <th>Purchased</th>
                  <th className="text-right">Age</th>
                  <th className="text-right">Cost</th>
                  {isOwner && <th className="text-right">EMI outstanding</th>}
                  <th>Deployment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="font-bold text-ink-900">{m.assetId}</td>
                    <td>{m.machineType}</td>
                    <td>
                      {m.make} {m.model}
                    </td>
                    <td className="text-right">{m.tonnageCapacity} T</td>
                    <td>{m.purchaseDate ? formatDateDDMMYYYY(m.purchaseDate) : '-'}</td>
                    <td className="text-right">{m.purchaseDate ? `${ageInYears(m.purchaseDate).toFixed(1)} yrs` : '-'}</td>
                    <td className="text-right">
                      <Currency value={m.purchaseCost || 0} size="xs" />
                    </td>
                    {isOwner && (
                      <td className="text-right">
                        {outstandingByAsset[m.assetId] ? (
                          <Currency value={outstandingByAsset[m.assetId]} size="xs" />
                        ) : (
                          <span className="text-ink-400">-</span>
                        )}
                      </td>
                    )}
                    <td className="max-w-[10rem] truncate">{projectName(m.currentProjectId) ?? '-'}</td>
                    <td>
                      <span className={`badge ${STATUS_META[m.status]?.badge ?? 'badge-neutral'}`}>
                        {STATUS_META[m.status]?.label ?? m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
};
