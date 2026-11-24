import React, { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  Search,
  Phone,
  MessageCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  MapPin,
  Wallet,
  AlertCircle,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { ContractorAvailability, ContractorRecord, ContractorSkill } from '../../types';
import { formatINR } from '../../utils/calculations';
import { contactActions } from '../../utils/contact';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SKILLS: Array<[ContractorSkill, string]> = [
  ['crane_operator', 'Crane Operator'],
  ['rigger', 'Rigger'],
  ['bankman', 'Bankman / Signalman'],
  ['electrician', 'Electrician'],
  ['fitter', 'Fitter / Mechanic'],
  ['driver', 'Driver'],
  ['other', 'Other'],
];
const SKILL_LABEL = Object.fromEntries(SKILLS) as Record<string, string>;

type AvailabilityFilter = 'all' | ContractorAvailability;

const EMPTY_FORM = {
  fullName: '',
  mobile: '',
  skill: 'crane_operator' as ContractorSkill,
  agencyName: '',
  dailyRate: '',
  city: '',
  availability: 'available' as ContractorAvailability,
  notes: '',
};

const availabilityTone = (value: ContractorAvailability) =>
  value === 'available' ? 'badge-success' : value === 'busy' ? 'badge-warning' : 'badge-neutral';

/** External / freelancer contacts used as backup when registered operators are unavailable. */
export const ContractorDirectoryView: React.FC = () => {
  const { contractors, addContractor, updateContractor, deleteContractor, currentUser } = useSkyhook();
  const canEdit = currentUser.role === 'owner';

  const [search, setSearch] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ContractorRecord | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);

  const availableCount = contractors.filter((c) => c.availability === 'available').length;
  const agencies = new Set(contractors.map((c) => c.agencyName).filter(Boolean)).size;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contractors.filter((c) => {
      const matchesAvailability =
        availabilityFilter === 'all' || c.availability === availabilityFilter;
      const matchesSearch =
        !term ||
        c.fullName.toLowerCase().includes(term) ||
        c.mobile.includes(term) ||
        c.contractorCode.toLowerCase().includes(term) ||
        (c.agencyName ?? '').toLowerCase().includes(term) ||
        (c.city ?? '').toLowerCase().includes(term);
      return matchesAvailability && matchesSearch;
    });
  }, [contractors, search, availabilityFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (record: ContractorRecord) => {
    setEditing(record);
    setForm({
      fullName: record.fullName,
      mobile: record.mobile,
      skill: record.skill,
      agencyName: record.agencyName ?? '',
      dailyRate: record.dailyRate ? String(record.dailyRate) : '',
      city: record.city ?? '',
      availability: record.availability,
      notes: record.notes ?? '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.fullName.trim() || !form.mobile.trim()) {
      setFormError('Name and mobile number are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      fullName: form.fullName.trim(),
      mobile: form.mobile.trim(),
      skill: form.skill,
      agencyName: form.agencyName.trim() || undefined,
      dailyRate: Number(form.dailyRate) || 0,
      city: form.city.trim() || undefined,
      availability: form.availability,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing) await updateContractor(editing.id, payload);
      else await addContractor(payload);
      setShowModal(false);
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the contractor. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: ContractorRecord) => {
    if (!window.confirm(`Remove "${record.fullName}" from the contractor directory?`)) return;
    setListError('');
    try {
      await deleteContractor(record.id);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not remove the contractor. Please try again.');
    }
  };

  /** Call / WhatsApp buttons rendered consistently on cards, table rows and the modal. */
  const ContactButtons = ({ mobile, label = 'Call' }: { mobile: string; label?: string }) => {
    const actions = contactActions(mobile);
    if (!actions.enabled) return null;
    return (
      <>
        <a href={actions.call} className="btn btn-primary btn-sm" title={`Call ${mobile}`}>
          <Phone className="h-3.5 w-3.5" />
          {label}
        </a>
        <a
          href={actions.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm"
          title={`Chat on WhatsApp with ${mobile}`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </a>
      </>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Contractor &amp; Freelancer Directory</h2>
          <p className="page-subtitle">
            Outside operators and contractors you can call or message on WhatsApp when your registered crew is unavailable.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={openAdd} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add Contractor
          </button>
        )}
      </div>

      {listError && (
        <div className="notice notice--danger text-xs" role="alert">{listError}</div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total contacts</span>
          <div className="stat-value">{contractors.length}</div>
          <span className="stat-hint">Freelancers &amp; contractors</span>
        </div>
        <div className="notice notice--success max-sm:flex-col max-sm:items-start max-sm:gap-0">
          <span className="stat-label text-success-800">Available now</span>
          <div className="stat-value text-success-900">{availableCount}</div>
          <span className="stat-hint text-success-700">Can be called in</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Agencies</span>
          <div className="stat-value">{agencies}</div>
          <span className="stat-hint">Distinct vendors</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Daily rate range</span>
          <div className="stat-value text-sm">
            {contractors.length
              ? `${formatINR(Math.min(...contractors.map((c) => c.dailyRate)))} – ${formatINR(Math.max(...contractors.map((c) => c.dailyRate)))}`
              : '-'}
          </div>
          <span className="stat-hint">Per day, as recorded</span>
        </div>
      </div>

      <div className="table-card">
        <div className="card-header filter-bar--split">
          <div className="tab-bar">
            {(
              [
                ['all', `All (${contractors.length})`],
                ['available', `Available (${availableCount})`],
                ['busy', `Busy (${contractors.filter((c) => c.availability === 'busy').length})`],
                ['unknown', 'Unknown'],
              ] as Array<[AvailabilityFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAvailabilityFilter(key)}
                className={`tab ${availabilityFilter === key ? 'tab-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search-box w-full sm:w-72">
            <Search className="w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search name, mobile, agency, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9"
              aria-label="Search contractors"
            />
          </div>
        </div>

        {/* Phones */}
        <div className="divide-y divide-line md:hidden">
          {filtered.map((c) => (
            <div key={c.id} className="space-y-3 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-900">{c.fullName}</span>
                    <span className={`badge ${availabilityTone(c.availability)}`}>{c.availability}</span>
                  </div>
                  <p className="text-[11px] text-ink-500">
                    {c.contractorCode} · {SKILL_LABEL[c.skill] ?? c.skill}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-ink-500">{c.mobile}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-600">
                {c.agencyName && <span className="flex items-center gap-1"><BriefcaseBusiness className="h-3 w-3" />{c.agencyName}</span>}
                {c.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>}
                <span className="flex items-center gap-1"><Wallet className="h-3 w-3" />{formatINR(c.dailyRate)}/day</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <ContactButtons mobile={c.mobile} />
                {canEdit && (
                  <>
                    <button type="button" onClick={() => openEdit(c)} className="btn btn-secondary btn-sm">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button type="button" onClick={() => void handleDelete(c)} className="btn btn-danger btn-sm">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop */}
        <div className="table-wrap hidden md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name / Skill</th>
                <th>Contact</th>
                <th>Agency / City</th>
                <th>Daily rate</th>
                <th>Availability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-[11px] text-ink-500">{c.contractorCode}</td>
                  <td>
                    <div className="font-semibold text-ink-900">{c.fullName}</div>
                    <div className="text-[11px] text-ink-500">{SKILL_LABEL[c.skill] ?? c.skill}</div>
                  </td>
                  <td className="text-xs text-ink-700">{c.mobile}</td>
                  <td>
                    <div className="text-xs text-ink-700">{c.agencyName || '-'}</div>
                    <div className="text-[11px] text-ink-500">{c.city || '-'}</div>
                  </td>
                  <td className="text-xs font-semibold text-ink-800">{formatINR(c.dailyRate)}</td>
                  <td><span className={`badge ${availabilityTone(c.availability)}`}>{c.availability}</span></td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ContactButtons mobile={c.mobile} />
                      {canEdit && (
                        <>
                          <button type="button" onClick={() => openEdit(c)} className="icon-btn" title="Edit contractor">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => void handleDelete(c)} className="icon-btn hover:text-danger-700" title="Remove contractor">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length && (
          <div className="empty-state">
            <BriefcaseBusiness className="h-8 w-8 text-ink-300" />
            <span className="text-sm font-semibold text-ink-700">No contractors found</span>
            <span className="text-xs text-ink-500">
              {contractors.length ? 'Try a different search or filter.' : 'Add a freelancer contact to call or WhatsApp them when needed.'}
            </span>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-header">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <BriefcaseBusiness className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="modal-title">{editing ? 'Edit contractor' : 'Add contractor / freelancer'}</h3>
                  <p className="text-xs text-ink-500">External contact - not added to your workforce.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="icon-btn" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                {formError && (
                  <div className="notice notice--danger text-xs" role="alert">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="form-label">Full name *</label>
                    <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="e.g. Ravi Yadav" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Mobile number *</label>
                    <input required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="e.g. 98765 43210" className="form-input" />
                    <p className="mt-1 text-[11px] text-ink-500">Used for the Call and WhatsApp buttons.</p>
                  </div>
                  <div>
                    <label className="form-label">Skill / trade</label>
                    <Select value={form.skill} onValueChange={(v) => setForm({ ...form, skill: v as ContractorSkill })}>
                      <SelectTrigger className="form-input" aria-label="Skill / trade">
                        <SelectValue placeholder="Select a skill" />
                      </SelectTrigger>
                      <SelectContent>
                        {SKILLS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="form-label">Agency / contractor name</label>
                    <input value={form.agencyName} onChange={(e) => setForm({ ...form, agencyName: e.target.value })} placeholder="e.g. Shree Crane Services" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Daily rate (₹)</label>
                    <input type="number" min="0" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} placeholder="e.g. 1200" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">City</label>
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Pune" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Availability</label>
                    <Select value={form.availability} onValueChange={(v) => setForm({ ...form, availability: v as ContractorAvailability })}>
                      <SelectTrigger className="form-input" aria-label="Availability">
                        <SelectValue placeholder="Select availability" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="busy">Busy</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Notes</label>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Experience, rates, how to reach…" className="form-input" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add contractor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
