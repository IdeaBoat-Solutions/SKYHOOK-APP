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

export const SettingsView: React.FC = () => {
  const {
    companySettings,
    updateCompanySettings,
    resetToDemoData,
    currentUser,
    setCurrentUserRole,
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
  const [standardShiftHours, setStandardShiftHours] = useState(companySettings.standardShiftHours);
  const [payrollPaymentDay, setPayrollPaymentDay] = useState(companySettings.payrollPaymentDay);

  // Lead times
  const [emiLead, setEmiLead] = useState(companySettings.emiReminderLeadDays);
  const [serviceLead, setServiceLead] = useState(companySettings.serviceReminderLeadDays);
  const [insuranceLead, setInsuranceLead] = useState(companySettings.insuranceReminderLeadDays);
  const [pucLead, setPucLead] = useState(companySettings.pucReminderLeadDays);
  const [fitnessLead, setFitnessLead] = useState(companySettings.fitnessReminderLeadDays);
  const [licenseLead, setLicenseLead] = useState(companySettings.licenseReminderLeadDays);

  const [savedSuccess, setSavedSuccess] = useState(false);

  // User Access Management State (Owner Control)
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('manager');
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);

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
      if (manager) setManagerPermissions(manager.permissions);
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
      setUserActionSuccess('Manager permissions saved. Managers must sign in again to receive the updated access token.');
    } catch (err) {
      setUserActionSuccess(err instanceof Error ? `Could not save permissions: ${err.message}` : 'Could not save permissions.');
    } finally {
      setPermissionsSaving(false);
    }
  };

  const permissionGroups = permissionCatalog.reduce<Record<string, PermissionInfo[]>>((acc, p) => {
    const domain = p.code.split(':')[0] || 'other';
    (acc[domain] ||= []).push(p);
    return acc;
  }, {});

  // Shared field styles — aligned with the Business Overview controls.
  const inputClass = 'form-input';
  const labelClass =
    'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-500';
  const selectClass = 'form-input w-auto';

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    try {
      addUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        phone: newUserPhone.trim() || undefined,
        role: newUserRole,
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      });
      setShowAddUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPhone('');
      setNewUserRole('manager');
      setUserActionSuccess('New staff user created and access assigned successfully.');
      setTimeout(() => setUserActionSuccess(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Error adding user');
    }
  };

  const handleRoleChange = (userId: string, targetRole: UserRole) => {
    updateUserRole(userId, targetRole);
    setUserActionSuccess(`Updated access permission to ${targetRole === 'owner' ? 'Owner / Admin' : 'Manager'}.`);
    setTimeout(() => setUserActionSuccess(null), 3000);
  };

  const handleDeleteStaffUser = (userId: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove user account for ${name}?`)) {
      deleteUser(userId);
      setUserActionSuccess(`Removed user account for ${name}.`);
      setTimeout(() => setUserActionSuccess(null), 3000);
    }
  };

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    updateCompanySettings({
      name,
      tagline,
      logoUrl,
      address,
      city,
      state,
      pincode,
      phone,
      email,
      gstNumber,
      authorizedSignatory: signatory,
      signatoryTitle,
      standardShiftHours: Number(standardShiftHours) || 10,
      payrollPaymentDay: Number(payrollPaymentDay) || 15,
      emiReminderLeadDays: Number(emiLead) || 15,
      serviceReminderLeadDays: Number(serviceLead) || 15,
      insuranceReminderLeadDays: Number(insuranceLead) || 15,
      pucReminderLeadDays: Number(pucLead) || 15,
      fitnessReminderLeadDays: Number(fitnessLead) || 15,
      licenseReminderLeadDays: Number(licenseLead) || 15,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
          {savedSuccess && (
            <span className="badge badge-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Settings Saved</span>
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveAll}
            className="btn btn-secondary btn-sm"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSaveAll} className="space-y-6">
        {/* SECTION 1: COMPANY BRANDING & LOGO */}
        <div className="card card-pad">
          <SectionHeader title="Company Profile & Brand Identity" icon={Building2} />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Logo Preview & Uploader */}
            <div className="rounded-lg border border-line bg-surface-muted p-4 text-center">
              <span className="stat-label block">Official Skyhook Logo</span>
              <div className="mx-auto mt-3 flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface p-2">
                <img
                  src={logoUrl || '/assets/image.png'}
                  alt="Skyhook Logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                Appears automatically on Sidebar, Dashboard, Login, and PDF Salary Slips.
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
                    required
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
                    required
                    value={gstNumber}
                    onChange={(e) => setGstNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Official Email</label>
                  <input
                    type="email"
                    required
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
                  required
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
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Pincode</label>
                  <input
                    type="text"
                    required
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
                    required
                    value={signatory}
                    onChange={(e) => setSignatory(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Signatory Title</label>
                  <input
                    type="text"
                    required
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
                min="8"
                max="14"
                value={standardShiftHours}
                onChange={(e) => setStandardShiftHours(parseInt(e.target.value, 10) || 10)}
                className="form-input"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                Default: <strong className="font-semibold text-ink-700">10 Hours per day</strong>. Net hours exceeding this qualify for site-rate overtime.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <label className={labelClass}>Monthly Salary Payment Due Day</label>
              <input
                type="number"
                min="1"
                max="28"
                value={payrollPaymentDay}
                onChange={(e) => setPayrollPaymentDay(parseInt(e.target.value, 10) || 15)}
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
                  value={emiLead}
                  onChange={(e) => setEmiLead(parseInt(e.target.value, 10) || 15)}
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
                  value={serviceLead}
                  onChange={(e) => setServiceLead(parseInt(e.target.value, 10) || 15)}
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
                  value={insuranceLead}
                  onChange={(e) => setInsuranceLead(parseInt(e.target.value, 10) || 15)}
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
                  value={pucLead}
                  onChange={(e) => setPucLead(parseInt(e.target.value, 10) || 15)}
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
                  value={fitnessLead}
                  onChange={(e) => setFitnessLead(parseInt(e.target.value, 10) || 15)}
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
                  value={licenseLead}
                  onChange={(e) => setLicenseLead(parseInt(e.target.value, 10) || 15)}
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
                  onClick={() => setShowAddUserModal(true)}
                  className="btn btn-secondary btn-sm"
                >
                  <UserPlus className="h-3.5 w-3.5 text-brand-700" />
                  <span>Add System Staff</span>
                </button>
              ) : undefined
            }
          />

          {userActionSuccess && (
            <div className="notice notice--success mb-4 items-start">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{userActionSuccess}</span>
            </div>
          )}

          {/* Access matrix — read from and written back to the backend. */}
          <div className="mb-4 rounded-lg border border-line bg-surface-muted p-3.5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-ink-900">Permission bifurcation</p>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-ink-500">
                  Owner / Admin always keeps full access. Tick exactly what managers may do; the backend stores this on the manager role and refreshes manager access tokens. Access-management permissions can never be granted to a manager.
                </p>
              </div>
              {isOwner && permissionsDirty && (
                <button
                  type="button"
                  onClick={saveManagerPermissions}
                  disabled={permissionsSaving}
                  className="btn btn-primary btn-sm"
                >
                  <Shield className="h-3.5 w-3.5" />
                  {permissionsSaving ? 'Saving…' : 'Save permissions'}
                </button>
              )}
            </div>
            {permissionCatalog.length === 0 ? (
              <p className="text-[11px] text-ink-500">Loading access matrix from the server…</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(permissionGroups).map(([domain, items]) => (
                  <div key={domain} className="rounded-md border border-line bg-surface p-2.5">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">{domain}</p>
                    {items.map((p) => {
                      const managerHas = managerPermissions.includes(p.code);
                      return (
                        <label key={p.id} className="flex items-center justify-between gap-2 py-1 text-[11px]">
                          <span className="min-w-0 truncate text-ink-700" title={p.code}>
                            {p.description || p.code}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="badge badge-neutral text-[9px] text-ink-900">Owner</span>
                            {isOwner ? (
                              <input
                                type="checkbox"
                                checked={managerHas}
                                onChange={() => toggleManagerPermission(p.code)}
                                aria-label={`Manager: ${p.code}`}
                                className="h-3.5 w-3.5 accent-ink-900"
                              />
                            ) : (
                              <span className={`text-[10px] font-semibold ${managerHas ? 'text-success-700' : 'text-ink-400'}`}>
                                {managerHas ? 'Allowed' : '—'}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Users List with Access Assignment Selectors */}
          <div className="card overflow-hidden">
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
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                              {u.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <span className="block truncate text-xs font-semibold text-ink-900">{u.name}</span>
                              <span className="block truncate text-[11px] text-ink-500">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3.5 py-3.5 pr-3 text-ink-600">{u.phone || 'N/A'}</td>
                        <td className="px-3.5 py-3.5 pr-3">
                          {currentUser.role === 'owner' ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={u.role}
                                onValueChange={(v) => handleRoleChange(u.id, v as UserRole)}
                                disabled={isCurrentSession && isOwnerRole && availableUsers.filter((x) => x.role === 'owner').length === 1}
                              >
                                <SelectTrigger className="form-input w-auto text-[11px]">
                                  <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="owner">Owner / Admin (Full Access)</SelectItem>
                                  <SelectItem value="manager">Manager (Site Operations)</SelectItem>
                                </SelectContent>
                              </Select>
                              {isCurrentSession && (
                                <span className="text-[10px] font-semibold text-ink-400">(You)</span>
                              )}
                            </div>
                          ) : (
                            <span
                              className={`badge badge-neutral ${
                                isOwnerRole ? 'text-ink-900' : 'text-ink-500'
                              }`}
                            >
                              {isOwnerRole ? 'Owner / Admin' : 'Manager'}
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setCurrentUserRole(u.role)}
                              className={`btn btn-sm ${
                                isCurrentSession ? 'btn-primary' : 'btn-secondary'
                              }`}
                            >
                              {isCurrentSession ? 'Active Session' : 'Switch Role'}
                            </button>
                            {currentUser.role === 'owner' && !isCurrentSession && (
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
        </div>

        {/* Bottom Save Action */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="btn btn-primary"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save All Company &amp; System Settings</span>
          </button>
        </div>
      </form>

      {/* Owner Add Staff Account Modal */}
      {showAddUserModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-700 bg-ink-900 px-5 py-4 text-white">
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
                className="icon-btn h-8 w-8 shrink-0 text-ink-300 hover:bg-ink-800 hover:text-white"
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

              <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line pt-4">
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
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Create Staff Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
