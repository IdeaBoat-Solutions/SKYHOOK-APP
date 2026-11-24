import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Building2,
  Calculator,
  BellRing,
  Shield,
  UploadCloud,
  CheckCircle2,
  Save,
  UserPlus,
  Trash2,
  X,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { UserRole } from '../../types';
import { BrandLogo } from '../common/BrandLogo';

type Feedback = { tone: 'success' | 'danger'; text: string };
const errText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
/** Whole-number text field; blank or invalid stays invalid instead of silently becoming a default. */
const intInRange = (v: string | number, min: number, max: number) => {
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export const SettingsView: React.FC = () => {
  const {
    companySettings,
    updateCompanySettings,
    currentUser,
    availableUsers,
    updateUserRole,
    addUser,
    deleteUser,
  } = useSkyhook();

  // Settings State
  const [name, setName] = useState(companySettings.name);
  const [tagline, setTagline] = useState(companySettings.tagline);
  const [logoUrl, setLogoUrl] = useState(companySettings.logoUrl);
  const [address, setAddress] = useState(companySettings.address);
  const [city, setCity] = useState(companySettings.city);
  const [state, setState] = useState(companySettings.state);
  const [pincode, setPincode] = useState(companySettings.pincode);
  const [phone, setPhone] = useState(companySettings.phone);
  const [email, setEmail] = useState(companySettings.email);
  const [gstNumber, setGstNumber] = useState(companySettings.gstNumber);
  const [signatory, setSignatory] = useState(companySettings.authorizedSignatory);
  const [signatoryTitle, setSignatoryTitle] = useState(companySettings.signatoryTitle);

  // Payroll policy
  const [standardShiftHours, setStandardShiftHours] = useState(String(companySettings.standardShiftHours));
  const [payrollPaymentDay, setPayrollPaymentDay] = useState(String(companySettings.payrollPaymentDay));

  // Lead times
  const [emiLead, setEmiLead] = useState(String(companySettings.emiReminderLeadDays));
  const [serviceLead, setServiceLead] = useState(String(companySettings.serviceReminderLeadDays));
  const [insuranceLead, setInsuranceLead] = useState(String(companySettings.insuranceReminderLeadDays));
  const [pucLead, setPucLead] = useState(String(companySettings.pucReminderLeadDays));
  const [fitnessLead, setFitnessLead] = useState(String(companySettings.fitnessReminderLeadDays));
  const [licenseLead, setLicenseLead] = useState(String(companySettings.licenseReminderLeadDays));

  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);
  const canEditCompany = currentUser.role === 'owner';

  // User Access Management State (Owner Control)
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [newUserRole, setNewUserRole] = useState<UserRole>('manager');
  const [userFeedback, setUserFeedback] = useState<Feedback | null>(null);
  const flashUser = (f: Feedback) => {
    setUserFeedback(f);
    if (f.tone === 'success') window.setTimeout(() => setUserFeedback((cur) => (cur === f ? null : cur)), 6000);
  };

  // Backend-owned permission bifurcation. The matrix is read from the API so
  // the UI can never drift from what the Edge Functions actually enforce.
  type RoleInfo = { id: string; name: string; label: string; permissions: string[] };
  type PermissionInfo = { id: string; code: string; description: string | null };
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionInfo[]>([]);
  const [managerPermissions, setManagerPermissions] = useState<string[]>([]);
  const [permissionsDirty, setPermissionsDirty] = useState(false);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const isOwner = currentUser.role === 'owner';

  const loadPermissions = async () => {
    try {
      const [roleRes, permRes] = await Promise.all([
        api.get<{ items: RoleInfo[] }>('/roles'),
        api.get<{ items: PermissionInfo[] }>('/permissions'),
      ]);
      setRoles(roleRes.items);
      setPermissionCatalog(permRes.items);
      const manager = roleRes.items.find((r) => r.name === 'manager');
      if (manager) setManagerPermissions(manager.permissions ?? []);
      setPermissionsDirty(false);
    } catch {
      // The rest of Settings stays usable if the user lacks user:read.
    }
  };

  useEffect(() => {
    if (isOwner) void loadPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  const toggleManagerPermission = (code: string) => {
    setManagerPermissions((prev) =>
      prev.includes(code) ? prev.filter((p) => p !== code) : [...prev, code],
    );
    setPermissionsDirty(true);
  };

  const saveManagerPermissions = async () => {
    setPermissionsSaving(true);
    try {
      await api.put('/roles/manager/permissions', { permissions: managerPermissions });
      await loadPermissions();
      flashUser({ tone: 'success', text: 'Manager permissions saved. Managers must sign in again to receive the updated access.' });
    } catch (err) {
      flashUser({ tone: 'danger', text: `Could not save permissions: ${errText(err, 'unknown error')}` });
    } finally {
      setPermissionsSaving(false);
    }
  };

  const permissionGroups = permissionCatalog.reduce<Record<string, PermissionInfo[]>>((acc, p) => {
    const domain = p.code.split(':')[0] || 'other';
    (acc[domain] ||= []).push(p);
    return acc;
  }, {});

  // Shared field styles - aligned with the Business Overview controls.
  const inputClass = 'form-input';
  const labelClass =
    'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-500';
  const selectClass = 'form-input w-auto';

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingUser) return;
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    if (newUserPassword.length < 8) {
      setModalError('Password must be at least 8 characters.');
      return;
    }
    setCreatingUser(true);
    setModalError(null);
    try {
      await addUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        phone: newUserPhone.trim() || undefined,
        role: newUserRole,
        password: newUserPassword,
      });
      setShowAddUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPhone('');
      setNewUserPassword('');
      setNewUserRole('manager');
      flashUser({ tone: 'success', text: 'New staff user created. They can sign in with the email and password you set.' });
    } catch (err) {
      setModalError(errText(err, 'Could not create the user.'));
    } finally {
      setCreatingUser(false);
    }
  };

  const handleRoleChange = async (userId: string, targetRole: UserRole) => {
    try {
      await updateUserRole(userId, targetRole);
      flashUser({
        tone: 'success',
        text: `Access changed to ${targetRole === 'owner' ? 'Owner / Admin' : 'Manager'}. The user must sign in again for it to take effect.`,
      });
    } catch (err) {
      flashUser({ tone: 'danger', text: `Could not change access: ${errText(err, 'unknown error')}` });
    }
  };

  const handleDeleteStaffUser = async (userId: string, name: string) => {
    if (!window.confirm(`Remove the user account for ${name}? They will no longer be able to sign in.`)) return;
    try {
      await deleteUser(userId);
      flashUser({ tone: 'success', text: `Removed user account for ${name}.` });
    } catch (err) {
      flashUser({ tone: 'danger', text: `Could not remove ${name}: ${errText(err, 'unknown error')}` });
    }
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !canEditCompany) return;
    const shift = Number(standardShiftHours);
    if (!(shift >= 1 && shift <= 24) || !Number.isInteger(shift * 2)) {
      setSaveFeedback({ tone: 'danger', text: 'Standard shift hours must be between 1 and 24, in steps of 0.5 (e.g. 9.5).' });
      return;
    }
    const payDay = intInRange(payrollPaymentDay, 1, 28);
    if (payDay === null) {
      setSaveFeedback({ tone: 'danger', text: 'Salary payment due day must be a whole number from 1 to 28.' });
      return;
    }
    const leads = [emiLead, serviceLead, insuranceLead, pucLead, fitnessLead, licenseLead].map((v) => intInRange(v, 0, 365));
    if (leads.some((v) => v === null)) {
      setSaveFeedback({ tone: 'danger', text: 'Reminder lead times must be whole days from 0 to 365.' });
      return;
    }
    const [emi, service, insurance, puc, fitness, license] = leads as number[];
    setSaving(true);
    setSaveFeedback(null);
    try {
      await updateCompanySettings({
        name: name.trim(),
        tagline,
        logoUrl: logoUrl.trim(),
        address,
        city,
        state,
        pincode,
        phone,
        email,
        gstNumber,
        authorizedSignatory: signatory,
        signatoryTitle,
        standardShiftHours: shift,
        payrollPaymentDay: payDay,
        emiReminderLeadDays: emi,
        serviceReminderLeadDays: service,
        insuranceReminderLeadDays: insurance,
        pucReminderLeadDays: puc,
        fitnessReminderLeadDays: fitness,
        licenseReminderLeadDays: license,
      });
      setSaveFeedback({ tone: 'success', text: 'Settings saved.' });
      window.setTimeout(() => setSaveFeedback((cur) => (cur?.tone === 'success' ? null : cur)), 4000);
    } catch (err) {
      setSaveFeedback({ tone: 'danger', text: `Could not save settings: ${errText(err, 'unknown error')}` });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setSaveFeedback({ tone: 'danger', text: 'Logo is larger than 1 MB. Please choose a smaller image.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setLogoUrl(base64);
    };
    reader.readAsDataURL(file);
  };

  // Consistent section heading used across every settings card.
  const SectionHeader: React.FC<{
    title: string;
    icon: React.ElementType;
    description?: string;
    action?: React.ReactNode;
  }> = ({ title, icon: Icon, description, action }) => (
    <div className="-mx-[1.125rem] mb-4 flex flex-col gap-3 border-b border-line px-[1.125rem] pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="section-icon">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-ink-900 sm:text-base">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title !mt-0">Company &amp; Payroll Settings</h2>
          <p className="mt-0.5 text-xs text-ink-500 sm:text-sm">
            Configure company branding, payroll rules, reminder windows and staff access.
          </p>
        </div>

        <div className="page-header-actions">
          {canEditCompany && (
            <button
              type="submit"
              form="company-settings-form"
              disabled={saving}
              className="btn btn-secondary btn-sm"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving…' : 'Save Configuration'}</span>
            </button>
          )}
        </div>
      </div>

      {saveFeedback && (
        <div role={saveFeedback.tone === 'danger' ? 'alert' : 'status'} className={`notice ${saveFeedback.tone === 'success' ? 'notice--success' : 'notice--danger'} items-start`}>
          {saveFeedback.tone === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span>{saveFeedback.text}</span>
        </div>
      )}

      {!canEditCompany && (
        <div className="notice notice--warning">
          <span>View only. Only the Owner / Admin can change company, payroll and access settings.</span>
        </div>
      )}

      <form id="company-settings-form" onSubmit={handleSaveAll} className="space-y-6">
        <fieldset disabled={!canEditCompany} className="m-0 min-w-0 space-y-6 border-0 p-0">
        {/* SECTION 1: COMPANY BRANDING & LOGO */}
        <div className="card card-pad">
          <SectionHeader title="Company Profile & Brand Identity" icon={Building2} />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Logo Preview & Uploader */}
            <div className="rounded-lg border border-line bg-surface-muted p-4 text-center">
              <span className="stat-label block">Official Skyhook Logo</span>
              <div className="mx-auto mt-3 flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface p-2">
                <BrandLogo src={logoUrl} alt="Skyhook Logo" className="h-full w-full" />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                Appears automatically on Sidebar, Dashboard, Login, and PDF Salary Slips. A broken link falls back to the Skyhook logo.
              </p>
              <label className="btn btn-secondary btn-sm mt-4 cursor-pointer">
                <UploadCloud className="h-3.5 w-3.5 text-brand-700" />
                Upload Custom Logo
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/svg+xml"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </label>
              <div className="mt-3 text-left">
                <label htmlFor="settings-logo-url" className={labelClass}>Or logo image URL</label>
                <input
                  id="settings-logo-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={logoUrl.startsWith('data:') ? '' : logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className={inputClass}
                />
                {logoUrl && (
                  <button type="button" onClick={() => setLogoUrl('')} className="btn btn-ghost btn-sm mt-1.5">
                    Use default logo
                  </button>
                )}
              </div>
            </div>

            {/* Entity details */}
            <div className="space-y-4 md:col-span-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Company Brand Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Official Tagline</label>
                  <input
                    type="text"
                                        value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>GSTIN Number</label>
                  <input
                    type="text"
                                        value={gstNumber}
                    onChange={(e) => setGstNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Official Email</label>
                  <input
                    type="email"
                                        value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Corporate Address</label>
                <input
                  type="text"
                                    value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelClass}>City</label>
                  <input
                    type="text"
                                        value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    type="text"
                                        value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Pincode</label>
                  <input
                    type="text"
                                        value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Authorized Signatory Name</label>
                  <input
                    type="text"
                                        value={signatory}
                    onChange={(e) => setSignatory(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Signatory Title</label>
                  <input
                    type="text"
                                        value={signatoryTitle}
                    onChange={(e) => setSignatoryTitle(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: PAYROLL & OPERATING POLICY */}
        <div className="card card-pad">
          <SectionHeader title="Payroll & Shift Configuration" icon={Calculator} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <label className={labelClass}>Standard Daily Shift Hours</label>
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                inputMode="decimal"
                value={standardShiftHours}
                onChange={(e) => setStandardShiftHours(e.target.value)}
                className="form-input"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                Default: <strong className="font-semibold text-ink-700">10 Hours per day</strong>. Change it any time (half hours allowed); attendance, overtime and the logsheet all follow it. Net hours beyond it qualify for site-rate overtime.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <label className={labelClass}>Monthly Salary Payment Due Day</label>
              <input
                type="number"
                min="1"
                max="28"
                inputMode="numeric"
                value={payrollPaymentDay}
                onChange={(e) => setPayrollPaymentDay(e.target.value)}
                className="form-input"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                Default: <strong className="font-semibold text-ink-700">15th of the following month</strong> for previous calendar month attendance.
              </p>
            </div>
          </div>
        </div>

        {/* SECTION 3: REMINDER LEAD TIME WINDOWS */}
        <div className="card card-pad">
          <SectionHeader
            title="Statutory Reminder Lead Times"
            icon={BellRing}
            description="Configures how many Days in advance pending items enter the active Red Alert window."
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>Machine EMI Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={emiLead}
                  onChange={(e) => setEmiLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>Machine Service Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={serviceLead}
                  onChange={(e) => setServiceLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>Insurance Renewal Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={insuranceLead}
                  onChange={(e) => setInsuranceLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>PUC Renewal Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={pucLead}
                  onChange={(e) => setPucLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>Fitness Test Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={fitnessLead}
                  onChange={(e) => setFitnessLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-3.5">
              <label className={labelClass}>Operator License Lead</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={licenseLead}
                  onChange={(e) => setLicenseLead(e.target.value)}
                  className={inputClass}
                />
                <span className="shrink-0 text-[11px] font-semibold text-ink-500">Days</span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4: USER ACCESS CONTROL & OWNER ROLE ASSIGNMENT */}
        <div className="card card-pad">
          <SectionHeader
            title="Staff Access Assignment & Permissions"
            icon={Shield}
            description={
              currentUser.role === 'owner'
                ? 'As Owner / Super Admin, you have full authority to assign or switch access types for all individuals.'
                : 'Restricted view. Only the Owner / Super Admin has the right to assign or change staff access types.'
            }
            action={
              currentUser.role === 'owner' ? (
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setNewUserPassword('');
                    setShowAddUserModal(true);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <UserPlus className="h-3.5 w-3.5 text-brand-700" />
                  <span>Add System Staff</span>
                </button>
              ) : undefined
            }
          />

          {userFeedback && (
            <div role={userFeedback.tone === 'danger' ? 'alert' : 'status'} className={`notice ${userFeedback.tone === 'success' ? 'notice--success' : 'notice--danger'} mb-4 items-start`}>
              {userFeedback.tone === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span>{userFeedback.text}</span>
            </div>
          )}

          {/* Access matrix - read from and written back to the backend. */}
          {isOwner && (
            <div className="mb-4 rounded-lg border border-line bg-surface-muted p-3.5">
              <div className="mb-3">
                <p className="text-xs font-semibold text-ink-900">Manager permissions</p>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-ink-500">
                  Owner / Admin always keeps full access. Tick exactly what managers may do. Access-management permissions can never be granted to a manager. Managers must sign in again after you save.
                </p>
              </div>
              {permissionCatalog.length === 0 ? (
                <p className="text-[11px] text-ink-500">Loading access matrix from the server…</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(permissionGroups).map(([domain, items]) => (
                    <div key={domain} className="rounded-md border border-line bg-surface p-2.5">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">{domain}</p>
                      {items.map((p) => (
                        <label key={p.id} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1 text-xs sm:min-h-[32px] sm:text-[11px]">
                          <span className="min-w-0 break-words text-ink-700" title={p.code}>
                            {p.description || p.code}
                          </span>
                          <input
                            type="checkbox"
                            checked={managerPermissions.includes(p.code)}
                            onChange={() => toggleManagerPermission(p.code)}
                            aria-label={`Manager: ${p.code}`}
                            className="h-5 w-5 shrink-0 accent-ink-900 sm:h-4 sm:w-4"
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {permissionsDirty && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={saveManagerPermissions}
                    disabled={permissionsSaving}
                    className="btn btn-primary w-full sm:w-auto"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {permissionsSaving ? 'Saving…' : 'Save manager permissions'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Users: stacked cards on phones, table from md up */}
          {availableUsers.length === 0 ? (
            <p className="text-xs text-ink-500">No staff accounts are visible to this login.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {availableUsers.map((u) => {
                  const isCurrentSession = currentUser.id === u.id;
                  const isOwnerRole = u.role === 'owner';
                  const lastOwner = isOwnerRole && availableUsers.filter((x) => x.role === 'owner').length === 1;
                  return (
                    <div key={u.id} className="rounded-lg border border-line bg-surface p-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-logo-700 text-xs font-semibold text-white">
                          {u.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-900">{u.name}</span>
                          <span className="block truncate text-xs text-ink-500">{u.email}</span>
                          {u.phone && <span className="block truncate text-xs text-ink-500">{u.phone}</span>}
                        </div>
                        {isCurrentSession && <span className="badge badge-brand shrink-0">You</span>}
                      </div>
                      {isOwner ? (
                        <div className="mt-3 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Select value={u.role} onValueChange={(v) => handleRoleChange(u.id, v as UserRole)} disabled={lastOwner}>
                              <SelectTrigger className="form-input w-full" aria-label={`Access type for ${u.name}`}>
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="owner">Owner / Admin (Full Access)</SelectItem>
                                <SelectItem value="manager">Manager (Site Operations)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {!isCurrentSession && (
                            <button
                              type="button"
                              onClick={() => handleDeleteStaffUser(u.id, u.name)}
                              aria-label={`Delete ${u.name}`}
                              className="icon-btn h-11 w-11 shrink-0 text-ink-500 hover:bg-danger-50 hover:text-danger-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="badge badge-neutral mt-3">{isOwnerRole ? 'Owner / Admin' : 'Manager'}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="card hidden overflow-hidden md:block">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead className="border-b border-line bg-surface-muted text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="px-4 py-3">Individual / Staff</th>
                        <th className="px-3.5 py-3">Contact</th>
                        <th className="px-3.5 py-3">Assigned Access Type</th>
                        <th className="px-3.5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-ink-800">
                      {availableUsers.map((u) => {
                        const isCurrentSession = currentUser.id === u.id;
                        const isOwnerRole = u.role === 'owner';
                        return (
                          <tr key={u.id} className="transition-colors hover:bg-surface-muted">
                            <td className="px-4 py-3.5 pr-3">
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-logo-700 text-[11px] font-semibold text-white">
                                  {u.name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <span className="block truncate text-xs font-semibold text-ink-900">{u.name}</span>
                                  <span className="block truncate text-[11px] text-ink-500">{u.email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3.5 py-3.5 pr-3 text-ink-600">{u.phone || '-'}</td>
                            <td className="px-3.5 py-3.5 pr-3">
                              {isOwner ? (
                                <Select
                                  value={u.role}
                                  onValueChange={(v) => handleRoleChange(u.id, v as UserRole)}
                                  disabled={isCurrentSession && isOwnerRole && availableUsers.filter((x) => x.role === 'owner').length === 1}
                                >
                                  <SelectTrigger className="form-input w-auto text-[11px]" aria-label={`Access type for ${u.name}`}>
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="owner">Owner / Admin (Full Access)</SelectItem>
                                    <SelectItem value="manager">Manager (Site Operations)</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="badge badge-neutral">{isOwnerRole ? 'Owner / Admin' : 'Manager'}</span>
                              )}
                            </td>
                            <td className="px-3.5 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {isCurrentSession && <span className="badge badge-brand">Active session</span>}
                                {isOwner && !isCurrentSession && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteStaffUser(u.id, u.name)}
                                    title="Delete user"
                                    aria-label={`Delete ${u.name}`}
                                    className="icon-btn h-8 w-8 text-ink-400 hover:bg-danger-50 hover:text-danger-700"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        </fieldset>

        {/* Bottom Save Action: sticky on phones so it is always reachable */}
        {canEditCompany && (
          <div className="sticky bottom-2 z-10 rounded-lg border border-line bg-surface p-2 shadow-md sm:static sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn btn-primary w-full sm:w-auto">
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'Saving…' : 'Save All Company & System Settings'}</span>
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Owner Add Staff Account Modal */}
      {showAddUserModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-700 bg-logo-700 px-5 py-4 text-white">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="!text-white text-sm font-semibold leading-tight tracking-tight">
                    Create Staff &amp; Assign Access Type
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-400">Add a new user and set their access scope</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                aria-label="Close"
                className="icon-btn h-8 w-8 shrink-0 text-ink-300 hover:bg-logo-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              <div>
                <label className={labelClass}>Full Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Suresh Deshmukh"
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Email Address (Login)</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="suresh@skyhook.in"
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Mobile Phone (Optional)</label>
                <input
                  type="tel"
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  placeholder="+91 98200 12345"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Temporary Password (min 8 characters)</label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="Set a password for this user"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
                <p className="mt-1.5 text-[11px] text-ink-500">
                  Share this password with the user so they can sign in.
                </p>
              </div>

              <div>
                <label className={labelClass}>Assigned Access Permission</label>
                <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as UserRole)}>
                  <SelectTrigger className={selectClass}>
                    <SelectValue placeholder="Select permission" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Site Operations Manager (Attendance, Logs, Expenses)</SelectItem>
                    <SelectItem value="owner">Owner / Super Admin (Full Finance, EMI, Role Control)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  Only the Owner can alter or elevate this role later.
                </p>
              </div>

              {modalError && (
                <div className="notice notice--danger text-xs" role="alert">{modalError}</div>
              )}

              <div className="sticky -bottom-5 -mx-5 -mb-5 flex shrink-0 items-center justify-end gap-2.5 border-t border-line bg-surface px-5 py-4">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingUser}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{creatingUser ? 'Creating…' : 'Create Staff Account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
