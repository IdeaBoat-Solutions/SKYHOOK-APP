import React, { useState } from 'react';
import {
  Shield,
  KeyRound,
  ArrowRight,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Briefcase,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { navigate } from '../../lib/nav';

/**
 * Credentials-only sign in. The server verifies the email + password against
 * the database and decides the user, tenant and role — the client holds no
 * user list and no passwords.
 */
export const LoginPage: React.FC = () => {
  const { login, companySettings } = useSkyhook();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password.');
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setErrorMessage(
        status === 401
          ? 'Invalid email or password.'
          : err instanceof Error
            ? err.message
            : 'Sign in failed. Please try again.',
      );
      setPassword('');
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
                src={companySettings.logoUrl || '/assets/image.png'}
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
                <p className="mt-0.5 text-xs text-ink-500">Your role is set by your account.</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <KeyRound className="h-5 w-5" />
              </div>
            </div>

            <div className="card-pad">
              <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
                {errorMessage && (
                  <div className="alert-banner" role="alert">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="text-xs">{errorMessage}</span>
                  </div>
                )}

                <div>
                  <label className="form-label" htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="login-password">Password</label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
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
                      <span>Sign in</span>
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
