import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  ReceiptIndianRupee,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Calendar,
  CreditCard,
  User,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { SalaryAdvance } from '../../types';

export const AdvancesView: React.FC = () => {
  const {
    advances,
    employees,
    addAdvance,
    currentDate,
    currentUser,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form Fields
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [amount, setAmount] = useState('5000');
  const [date, setDate] = useState(currentDate);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'bank_transfer' | 'upi' | 'cheque'>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [remarks, setRemarks] = useState('');

  const operators = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');

  const handleCreateAdvance = (e: React.FormEvent) => {
    e.preventDefault();
    addAdvance({
      employeeId,
      date,
      amount: parseFloat(amount) || 0,
      paymentMode,
      paymentReference,
      remarks,
      approvedBy: currentUser.name,
    });
    setShowAddModal(false);
    setRemarks('');
    setPaymentReference('');
  };

  const totalDisbursed = advances.reduce((s, a) => s + a.amount, 0);
  const totalRecovered = advances.reduce((s, a) => s + a.recoveryAmount, 0);
  const totalOutstanding = advances.reduce((s, a) => s + a.outstandingBalance, 0);

  const filteredAdvances = advances.filter((adv) => {
    const emp = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
    return (
      !searchTerm ||
      emp?.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      adv.advanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (adv.remarks && adv.remarks.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">
            Salary Advance Management
          </h2>
          <p className="page-subtitle">
            Disburse advances to operators, manage partial recoveries in monthly payroll, and carry forward outstanding balances.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span>Record New Advance</span>
        </button>
      </div>

      {/* KPI Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total Advances Disbursed</span>
          <div className="stat-value">{formatINR(totalDisbursed)}</div>
          <span className="stat-hint">Total historical disbursements</span>
        </div>

        <div className="notice notice--success">
          <span className="stat-label text-success-800">Total Recovered via Payroll</span>
          <div className="stat-value text-success-900">{formatINR(totalRecovered)}</div>
          <span className="stat-hint text-success-700">Deducted from approved payrolls</span>
        </div>

        <div className="notice notice--warning">
          <span className="stat-label text-warning-800">Outstanding Balance</span>
          <div className="stat-value text-warning-900">{formatINR(totalOutstanding)}</div>
          <span className="stat-hint text-warning-700">To be recovered in future payouts</span>
        </div>
      </div>

      {/* Advance Records Table */}
      <div className="table-card">
        <div className="card-header">
          <div className="search-box w-full">
            <Search className="w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search by operator or advance ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input pl-9"
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Advance ID</th>
                <th className="px-3.5 py-3">Date</th>
                <th className="px-3.5 py-3">Operator</th>
                <th className="px-3.5 py-3">Disbursed Amount</th>
                <th className="px-3.5 py-3">Recovered So Far</th>
                <th className="px-3.5 py-3">Outstanding Balance</th>
                <th className="px-3.5 py-3">Payment Mode & Ref</th>
                <th className="px-3.5 py-3">Remarks / Reason</th>
                <th className="px-3.5 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-700">
              {filteredAdvances.map((adv) => {
                const op = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
                const isFullyRecovered = adv.status === 'fully_recovered';
                return (
                  <tr key={adv.id} className="transition-colors">
                    <td className="px-3.5 py-3 font-bold text-ink-900">
                      {adv.advanceId}
                    </td>
                    <td className="px-3.5 py-3 text-ink-600">
                      {formatDateDDMMYYYY(adv.date)}
                    </td>
                    <td className="px-3.5 py-3 font-semibold">
                      <div className="text-ink-900 font-bold">{op?.fullName || adv.employeeId}</div>
                      <span className="text-[10px] text-ink-500">{op?.employeeId}</span>
                    </td>
                    <td className="px-3.5 py-3 font-bold text-ink-900">
                      {formatINR(adv.amount)}
                    </td>
                    <td className="px-3.5 py-3 font-semibold text-success-700">
                      {formatINR(adv.recoveryAmount)}
                    </td>
                    <td className="px-3.5 py-3 font-bold text-warning-900 bg-warning-50/40">
                      {formatINR(adv.outstandingBalance)}
                    </td>
                    <td className="px-3.5 py-3 text-ink-600">
                      <span className="capitalize">{adv.paymentMode.replace('_', ' ')}</span>
                      {adv.paymentReference && (
                        <span className="text-[10px] text-ink-400 block">{adv.paymentReference}</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-ink-600 max-w-xs truncate">
                      {adv.remarks || '-'}
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      <span
                        className={`badge ${
                          isFullyRecovered
                            ? 'badge-success'
                            : 'badge-warning'
                        }`}
                      >
                        {adv.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Advance Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Disburse Salary Advance</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAdvance} className="modal-body space-y-4 text-xs">
              <div>
                <label className="form-label">Select Operator:</label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        {op.fullName} ({op.employeeId}) – Daily: ₹{op.dailyRate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="stat-grid">
                <div>
                  <label className="form-label">Advance Amount (₹):</label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 5000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Disbursal Date:</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="stat-grid">
                <div>
                  <label className="form-label">Payment Mode:</label>
                  <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as any)}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select payment mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer / IMPS</SelectItem>
                      <SelectItem value="upi">Company UPI</SelectItem>
                      <SelectItem value="cash">Cash Handover</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="form-label">Ref / UTR Number:</label>
                  <input
                    type="text"
                    placeholder="e.g. IMPS-991208"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Reason / Purpose of Advance:</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Medical emergency assistance, travel advance..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Disburse Advance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
