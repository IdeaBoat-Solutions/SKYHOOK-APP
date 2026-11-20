import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Receipt,
  Download,
  Calendar,
  Layers,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { exportProjectExpenses } from '../../utils/excelAndPdf';
import { ProjectExpense } from '../../types';

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    projects,
    addExpense,
    approveExpense,
    currentUser,
    currentDate,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  const [showAddModal, setShowAddModal] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [date, setDate] = useState(currentDate);
  const [category, setCategory] = useState('Diesel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('35000');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'company_card' | 'bank_transfer' | 'upi'>('company_card');
  const [vendor, setVendor] = useState('HPCL Petrol Pump');
  const [receiptNumber, setReceiptNumber] = useState('HPCL-9921');

  const categories = [
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

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addExpense({
      projectId,
      date,
      category,
      description,
      amount: parseFloat(amount) || 0,
      paymentMode,
      paidBy: currentUser.name,
      vendor,
      receiptNumber,
      approvalStatus: currentUser.role === 'owner' ? 'approved' : 'pending',
    });
    setShowAddModal(false);
    setDescription('');
  };

  const filteredExpenses = expenses.filter((exp) => {
    const matchProject = filterProject === 'all' || exp.projectId === filterProject;
    const matchCategory = filterCategory === 'all' || exp.category === filterCategory;
    const prj = projects.find((p) => p.id === exp.projectId);
    const matchSearch =
      !searchTerm ||
      exp.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prj && prj.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (exp.vendor && exp.vendor.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchProject && matchCategory && matchSearch;
  });

  const totalExpenseAmount = filteredExpenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              Project Accounting
            </span>
            <span className="text-xs text-slate-500 font-medium">Site Cost Centers</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-logo-900 mt-1 tracking-tight">
            Project-Wise Expense Management
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">
            Capture crane diesel fuel vouchers, mechanical spare parts, site transport tolls, and vendor billings.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => exportProjectExpenses(filteredExpenses, projects)}
            className="px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-logo-900 font-bold text-xs transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-zinc-600" />
            <span>Export XLSX</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-700 text-white font-bold text-xs transition-colors shadow-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense Voucher</span>
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Filtered Expenses</span>
          <div className="text-2xl font-black text-logo-900 mt-1">{filteredExpenses.length}</div>
          <span className="text-[10px] text-slate-400">Total expense vouchers</span>
        </div>

        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 shadow-2xs">
          <span className="text-xs font-bold text-rose-800 uppercase">Total Project Outflow</span>
          <div className="text-2xl font-black text-rose-900 mt-1">{formatINR(totalExpenseAmount)}</div>
          <span className="text-[10px] text-rose-700">Combined project operational expenditures</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Pending Approvals</span>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {expenses.filter((e) => e.approvalStatus === 'pending').length}
          </div>
          <span className="text-[10px] text-slate-400">Vouchers submitted by managers</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendor, description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
          />
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
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
                    <td className="px-3.5 py-3 font-mono font-bold text-slate-900">
                      {exp.expenseId || exp.id}
                    </td>
                    <td className="px-3.5 py-3 text-slate-600">
                      {formatDateDDMMYYYY(exp.date)}
                    </td>
                    <td className="px-3.5 py-3 font-semibold text-slate-900">
                      {prj?.name || exp.projectId}
                    </td>
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
                      {exp.paymentMode.replace('_', ' ')}
                      <span className="text-[10px] text-slate-400 block font-normal">By: {exp.paidBy}</span>
                    </td>
                    <td className="px-3.5 py-3 font-mono font-black text-rose-800 text-sm">
                      {formatINR(exp.amount)}
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          exp.approvalStatus === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {exp.approvalStatus}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      {exp.approvalStatus === 'pending' && currentUser.role === 'owner' ? (
                        <button
                          onClick={() => approveExpense(exp.id)}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                        >
                          Approve
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Approved</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-logo-950/80 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="px-6 py-4 bg-logo-700 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Add Project Expense Voucher</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Project Site:</label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-semibold"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Expense Date:</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Expense Category:</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Amount (₹):</label>
                  <input
                    type="number"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Mode:</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="company_card">Company Debit / Credit Card</option>
                    <option value="upi">UPI Account</option>
                    <option value="bank_transfer">Bank Transfer / NEFT</option>
                    <option value="cash">Site Petty Cash</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vendor / Supplier:</label>
                  <input
                    type="text"
                    placeholder="e.g. HPCL Petrol Pump, Hydrotech"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Receipt / Invoice Number:</label>
                <input
                  type="text"
                  placeholder="e.g. HPCL-GH-9982"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description / Purpose:</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. 450 Litres High-Speed Diesel for Liebherr crane"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 font-bold text-white bg-logo-700 hover:bg-logo-800 rounded-xl shadow-xs"
                >
                  Record Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
