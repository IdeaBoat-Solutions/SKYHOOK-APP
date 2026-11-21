import React, { useState } from 'react';
import { Plus, Search, Filter, CheckCircle2, Download, X } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { exportProjectExpenses } from '../../utils/excelAndPdf';

import { DateInput } from '../common/DateInput';
import { PeriodFilter, inPeriod, defaultPeriod, type PeriodState } from '../common/PeriodFilter';

type PayMode = 'cash' | 'company_card' | 'bank_transfer' | 'upi' | 'cheque';

const PAYMENT_MODES: { value: PayMode; label: string }[] = [
  { value: 'company_card', label: 'Company Debit / Credit Card' },
  { value: 'upi', label: 'UPI Account' },
  { value: 'bank_transfer', label: 'Bank Transfer / NEFT' },
  { value: 'cash', label: 'Site Petty Cash' },
  { value: 'cheque', label: 'Cheque' },
];

const CATEGORIES = [
  'Diesel',
  'Fuel',
  'Machine Repair',
  'Maintenance',
  'Spare Parts',
  'Transport',
  'Food',
  'Labour',
  'Accommodation',
  'Toll & Transport',
  'Miscellaneous',
];

/** The server keeps manager vouchers as draft/submitted until the owner approves them. */
const isApproved = (status: string) => status === 'approved';
const isRejected = (status: string) => status === 'rejected';
const isAwaiting = (status: string) => !isApproved(status) && !isRejected(status);
const modeText = (mode: string) => (mode === 'upi' ? 'UPI' : mode.replace(/_/g, ' '));
const statusText = (status: string) => (isApproved(status) ? 'approved' : isRejected(status) ? 'rejected' : 'pending');

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    projects,
    addExpense,
    approveExpense,
    currentUser,
    currentDate,
  } = useSkyhook();

  const isOwner = currentUser.role === 'owner';

  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod('month'));
  const [pageError, setPageError] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(currentDate);
  const [category, setCategory] = useState('Diesel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PayMode>('company_card');
  const [vendor, setVendor] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');

  const openAddModal = () => {
    setProjectId(projects[0]?.id ?? '');
    setDate(currentDate);
    setCategory('Diesel');
    setPaymentMode('company_card');
    setDescription('');
    setAmount('');
    setVendor('');
    setReceiptNumber('');
    setFormError('');
    setShowAddModal(true);
  };

  const handleApprove = async (id: string) => {
    if (approvingId) return;
    setApprovingId(id);
    setPageError('');
    try {
      await approveExpense(id);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Could not approve the expense. Please try again.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const value = parseFloat(amount);
    if (!projectId) return setFormError('Choose a project first. Create one under Project Management if there are none.');
    if (!Number.isFinite(value) || value <= 0) return setFormError('Enter the expense amount.');
    setSaving(true);
    setFormError('');
    try {
      await addExpense({
        projectId,
        date,
        category,
        description,
        amount: value,
        paymentMode,
        paidBy: currentUser.name,
        vendor: vendor.trim() || undefined,
        receiptNumber: receiptNumber.trim() || undefined,
        approvalStatus: isOwner ? 'approved' : 'pending',
      });
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the expense.');
    } finally {
      setSaving(false);
    }
  };

  const filteredExpenses = expenses.filter((exp) => {
    const matchProject = filterProject === 'all' || exp.projectId === filterProject;
    const matchCategory = filterCategory === 'all' || exp.category === filterCategory;
    const prj = projects.find((p) => p.id === exp.projectId);
    const q = searchTerm.toLowerCase();
    const matchSearch =
      !q ||
      exp.description.toLowerCase().includes(q) ||
      exp.category.toLowerCase().includes(q) ||
      (prj && prj.name.toLowerCase().includes(q)) ||
      (exp.vendor && exp.vendor.toLowerCase().includes(q));

    return matchProject && matchCategory && matchSearch && inPeriod(exp.date, period, currentDate);
  });

  const totalExpenseAmount = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const pendingCount = expenses.filter((e) => isAwaiting(e.approvalStatus)).length;

  const statusBadge = (status: string) => (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        isApproved(status)
          ? 'bg-emerald-100 text-emerald-800'
          : isRejected(status)
          ? 'bg-rose-100 text-rose-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {statusText(status)}
    </span>
  );

  const actionCell = (id: string, status: string) =>
    isAwaiting(status) ? (
      isOwner ? (
        <button
          onClick={() => void handleApprove(id)}
          disabled={approvingId === id}
          className="btn btn-primary btn-sm"
        >
          {approvingId === id ? 'Approving…' : 'Approve'}
        </button>
      ) : (
        <span className="text-[11px] font-semibold text-amber-700">Awaiting owner</span>
      )
    ) : isApproved(status) ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>Approved</span>
      </span>
    ) : (
      <span className="text-[11px] font-bold text-rose-700">Rejected</span>
    );

  return (
    <div className="space-y-4 sm:space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              Project Accounting
            </span>
            <span className="text-xs text-slate-500 font-medium">Site Cost Centers</span>
          </div>
          <h2 className="page-title">Project-Wise Expense Management</h2>
          <p className="page-subtitle">
            Capture crane diesel fuel vouchers, mechanical spare parts, site transport tolls, and vendor billings.
          </p>
        </div>

        <div className="page-header-actions">
          <button onClick={openAddModal} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span>Add Expense Voucher</span>
          </button>
          <button onClick={() => exportProjectExpenses(filteredExpenses, projects)} className="btn btn-secondary">
            <Download className="w-4 h-4" />
            <span>Export XLSX</span>
          </button>
        </div>
      </div>

      {pageError && (
        <div className="notice notice--danger flex items-start justify-between gap-3 text-xs" role="alert">
          <span className="break-words min-w-0">{pageError}</span>
          <button onClick={() => setPageError('')} className="shrink-0" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="stat-card">
          <span className="stat-label">Filtered Expenses</span>
          <div className="stat-value">{filteredExpenses.length}</div>
          <span className="stat-hint">Total expense vouchers</span>
        </div>

        <div className="stat-card !bg-rose-50 !border-rose-200 order-3 col-span-2 sm:order-none sm:col-span-1">
          <span className="stat-label text-rose-800">Total Project Outflow</span>
          <div className="stat-value text-rose-900">{formatINR(totalExpenseAmount)}</div>
          <span className="stat-hint text-rose-700">Combined operational expenditure</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Pending Approvals</span>
          <div className="stat-value text-amber-600">{pendingCount}</div>
          <span className="stat-hint">Vouchers awaiting the owner</span>
        </div>
      </div>

      <PeriodFilter value={period} onChange={setPeriod} />

      {/* Filters Bar */}
      <div className="filter-bar">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              aria-label="Filter by project"
              className="form-input min-w-0"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            aria-label="Filter by category"
            className="form-input min-w-0"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="search-box w-full sm:w-72">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="Search vendor, description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      {/* Expenses */}
      <div className="table-card">
        {filteredExpenses.length === 0 && (
          <p className="p-6 text-center text-xs text-slate-500">No expense vouchers match these filters.</p>
        )}

        {/* Phones: cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredExpenses.map((exp) => {
            const prj = projects.find((p) => p.id === exp.projectId);
            return (
              <div key={exp.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 break-words">{exp.description}</div>
                    <div className="text-[11px] text-slate-500">
                      {exp.expenseId || exp.id} • {formatDateDDMMYYYY(exp.date)}
                    </div>
                  </div>
                  <div className="font-mono font-black text-rose-800 text-base shrink-0">{formatINR(exp.amount)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] uppercase">
                    {exp.category}
                  </span>
                  <span className="text-slate-600 break-words">{prj?.name || exp.projectId}</span>
                </div>
                <div className="text-[11px] text-slate-500 break-words">
                  <span className="capitalize">{modeText(exp.paymentMode)}</span> • By {exp.paidBy}
                  {exp.vendor && ` • Vendor: ${exp.vendor}`}
                  {exp.receiptNumber && ` • Bill #${exp.receiptNumber}`}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  {statusBadge(exp.approvalStatus)}
                  {actionCell(exp.id, exp.approvalStatus)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Larger screens: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-logo-700 text-white font-semibold uppercase text-[11px]">
              <tr>
                <th className="px-3.5 py-3">Expense ID</th>
                <th className="px-3.5 py-3">Date</th>
                <th className="px-3.5 py-3">Project Site</th>
                <th className="px-3.5 py-3">Category</th>
                <th className="px-3.5 py-3">Description & Vendor</th>
                <th className="px-3.5 py-3">Payment Mode</th>
                <th className="px-3.5 py-3">Amount</th>
                <th className="px-3.5 py-3 text-center">Status</th>
                <th className="px-3.5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredExpenses.map((exp) => {
                const prj = projects.find((p) => p.id === exp.projectId);
                return (
                  <tr key={exp.id} className="hover:bg-slate-50/80">
                    <td className="px-3.5 py-3 font-mono font-bold text-slate-900">{exp.expenseId || exp.id}</td>
                    <td className="px-3.5 py-3 text-slate-600">{formatDateDDMMYYYY(exp.date)}</td>
                    <td className="px-3.5 py-3 font-semibold text-slate-900">{prj?.name || exp.projectId}</td>
                    <td className="px-3.5 py-3">
                      <span className="font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] uppercase">
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-slate-700 max-w-sm">
                      <div className="font-medium">{exp.description}</div>
                      {exp.vendor && (
                        <div className="text-[10px] text-slate-400">
                          Vendor: {exp.vendor} • Bill #{exp.receiptNumber || 'N/A'}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-slate-600 capitalize">
                      {modeText(exp.paymentMode)}
                      <span className="text-[10px] text-slate-400 block font-normal">By: {exp.paidBy}</span>
                    </td>
                    <td className="px-3.5 py-3 font-mono font-black text-rose-800 text-sm">{formatINR(exp.amount)}</td>
                    <td className="px-3.5 py-3 text-center">{statusBadge(exp.approvalStatus)}</td>
                    <td className="px-3.5 py-3 text-right">{actionCell(exp.id, exp.approvalStatus)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Add Project Expense Voucher</h3>
              <button onClick={() => setShowAddModal(false)} className="icon-btn" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form id="expense-form" onSubmit={handleAddSubmit} className="modal-body space-y-4 text-xs">
              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800" role="alert">
                  <span className="font-semibold">{formError}</span>
                </div>
              )}
              {!isOwner && (
                <p className="text-[11px] text-slate-500">This voucher will wait for the owner's approval.</p>
              )}
              <div className="form-grid">
                <div>
                  <label className="form-label">Project Site:</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="form-input font-semibold">
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Expense Date:</label>
                  <DateInput required value={date} onChange={(e) => setDate(e.target.value)} className="form-input" />
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Expense Category:</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="form-input font-bold">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Amount (₹):</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    required
                    min="1"
                    placeholder="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="form-input font-mono font-bold"
                  />
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Payment Mode:</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PayMode)}
                    className="form-input"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Vendor / Supplier:</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Receipt / Invoice Number:</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  className="form-input font-mono"
                />
              </div>

              <div>
                <label className="form-label">Description / Purpose:</label>
                <textarea
                  rows={2}
                  required
                  placeholder="What was this expense for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-input"
                />
              </div>
            </form>

            <div className="modal-footer">
              <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" form="expense-form" disabled={saving} className="btn btn-primary">
                {saving ? 'Saving…' : 'Record Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
