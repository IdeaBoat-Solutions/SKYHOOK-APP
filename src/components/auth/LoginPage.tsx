import React, { useState } from 'react';
import {
  Shield,
  KeyRound,
  ArrowRight,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Briefcase,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { User } from '../../types';
import { navigate } from '../../lib/nav';

export const LoginPage: React.FC = () => {
  const { availableUsers, login, companySettings } = useSkyhook();

  const [selectedUserId, setSelectedUserId] = useState<string>(availableUsers[0]?.id || 'USR-001');
  const [email, setEmail] = useState<string>(availableUsers[0]?.email || 'owner@skyhook.in');
  const [password, setPassword] = useState<string>('skyhook2026');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const selectedUser = availableUsers.find((u) => u.id === selectedUserId) || availableUsers[0];

  const handleSelectUser = (u: User) => {
    setSelectedUserId(u.id);
    setEmail(u.email);
    setPassword('skyhook2026');
    setErrorMessage('');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const targetUser = availableUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) || selectedUser;

    if (!targetUser) {
      setErrorMessage('User with this email not found. Please choose from registered profiles.');
      return;
    }

    if (!password || password.trim().length === 0) {
      setErrorMessage('Please enter your access password or security PIN.');
      return;
    }

    setIsLoading(true);
    try {
      await login(targetUser, password);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Login failed. Check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = async (u: User) => {
    setErrorMessage('');
    setIsLoading(true);
    try {
      await login(u, 'skyhook2026');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Login failed. Check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80" aria-label="Skyhook home">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface p-1.5">
              <img
                src={companySettings.logoUrl || '/assets/aistudio/SH_e808acaf.png'}
                alt="Skyhook Logo"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold tracking-tight text-ink-900">
                  {companySettings.name || 'SKYHOOK'}
                </span>
                <span className="badge badge-brand uppercase">ERP System</span>
              </div>
              <p className="text-[11px] text-ink-500">
                Heavy Equipment Fleet &amp; Workforce Operations
              </p>
            </div>
          </a>
          <span className="hidden items-center gap-2 rounded-full border border-line bg-surface-muted px-3 py-1 text-xs font-medium text-ink-600 sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-success-600" />
            Secure Portal
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl grid-cols-1 items-center gap-8 lg:grid-cols-12">
          {/* Brand & access information */}
          <div className="space-y-5 lg:col-span-5">
            <div>
              <span className="eyebrow">
                <Shield className="h-3.5 w-3.5" />
                Role-Based Access
              </span>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
                Secure access to Skyhook ERP
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                Coordinate operator attendance, statutory renewals, multi-project overtime and
                automated payroll from one place.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-brand-700">
                    <Lock className="h-4 w-4" />
                    Owner / Super Admin
                  </span>
                  <span className="badge badge-success uppercase">Full Access</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">
                  Exclusive access to EMI loans, amortization, role assignment and final payroll lock.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                    <Briefcase className="h-4 w-4 text-ink-500" />
                    Site Operations Manager
                  </span>
                  <span className="badge badge-neutral uppercase">Site Access</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">
                  Field operations, attendance, overtime entries, crane hours and expense vouchers.
                </p>
              </div>
            </div>
          </div>

          {/* Sign-in card */}
          <div className="card lg:col-span-7">
            <div className="card-header">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink-900">System Sign In</h2>
                <p className="mt-0.5 text-xs text-ink-500">Select a profile or enter your credentials</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <KeyRound className="h-5 w-5" />
              </div>
            </div>

            <div className="card-pad">
              <p className="form-label">Select Account Profile</p>
              <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {availableUsers.map((u) => {
                  const isSelected = u.id === selectedUserId;
                  const isOwner = u.role === 'owner';
                  return (
                    <button
                      type="button"
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={`flex flex-col justify-between rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line bg-surface-muted hover:border-line-strong hover:bg-surface'
                      }`}
                    >
                      <div className="mb-2 flex w-full items-center justify-between">
                        <span
                          className={`badge uppercase ${
                            isOwner ? 'badge-neutral' : 'badge-brand'
                          }`}
                        >
                          {isOwner ? 'Owner / Admin' : 'Manager'}
                        </span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                      </div>
                      <span className="truncate text-sm font-semibold text-ink-900">{u.name}</span>
                      <span className="truncate text-xs text-ink-500">{u.email}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
                {errorMessage && (
                  <div className="alert-banner">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="text-xs">{errorMessage}</span>
                  </div>
                )}

                <div>
                  <label className="form-label">Email / Username</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@skyhook.in"
                    required
                    className="form-input"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-semibold text-ink-700">Password / Access PIN</label>
                    <span className="text-[11px] text-ink-400">Demo: skyhook2026</span>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      required
                      className="form-input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn btn-primary mt-1 w-full"
                >
                  {isLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span>Verifying credentials...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in as {selectedUser?.name ?? 'Loading profiles…'}</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-ink-500">
                  New to Skyhook?{' '}
                  <a
                    href="/register"
                    onClick={(e) => { e.preventDefault(); navigate('/register'); }}
                    className="font-semibold text-ink-800 underline decoration-line-strong underline-offset-2 hover:text-brand-700"
                  >
                    Create an account
                  </a>
                </p>

                <div className="pt-1">
                  <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-ink-400">
                    Instant Test Login
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const owner = availableUsers.find((u) => u.role === 'owner') || availableUsers[0];
                        handleQuickLogin(owner);
                      }}
                      className="btn btn-secondary"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Owner Login
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const manager = availableUsers.find((u) => u.role === 'manager') || availableUsers[1] || availableUsers[0];
                        handleQuickLogin(manager);
                      }}
                      className="btn btn-primary"
                    >
                      <Briefcase className="h-3.5 w-3.5" />
                      Manager Login
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-surface px-6 py-3 text-center text-[11px] text-ink-500">
        <a href="/" className="font-semibold text-ink-700 underline decoration-line-strong underline-offset-2 hover:text-brand-700">
          Back to site
        </a>
        <span className="mx-2 text-line-strong">&middot;</span>
        SKYHOOK ERP &middot; Enterprise Crane Business Operations &middot; Confidential &amp; Proprietary
      </footer>
    </div>
  );
};
