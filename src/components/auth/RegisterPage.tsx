import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Building2, Eye, EyeOff, UserPlus } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { navigate } from '../../lib/nav';
import { BrandLogo } from '../common/BrandLogo';

type Field = 'companyName' | 'name' | 'email' | 'phone' | 'password' | 'confirm';
type Errors = Partial<Record<Field, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(v: Record<Field, string>): Errors {
  const e: Errors = {};
  if (v.companyName.trim().length < 2) e.companyName = 'Enter your company name.';
  if (v.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!EMAIL_RE.test(v.email.trim())) e.email = 'Enter a valid email address.';
  if (v.phone.trim() && !/^[+\d][\d\s-]{6,}$/.test(v.phone.trim())) e.phone = 'Enter a valid phone number.';
  if (v.password.length < 8) e.password = 'Use at least 8 characters.';
  if (v.confirm !== v.password) e.confirm = 'Passwords do not match.';
  return e;
}

export const RegisterPage: React.FC = () => {
  const { register } = useSkyhook();
  const [values, setValues] = useState<Record<Field, string>>({
    companyName: '', name: '', email: '', phone: '', password: '', confirm: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...values, [f]: e.target.value };
    setValues(next);
    if (touched[f]) setErrors(validate(next));
  };
  const blur = (f: Field) => () => {
    setTouched((t) => ({ ...t, [f]: true }));
    setErrors(validate(values));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const found = validate(values);
    setErrors(found);
    setTouched({ companyName: true, name: true, email: true, phone: true, password: true, confirm: true });
    if (Object.keys(found).length) return;

    setIsLoading(true);
    try {
      await register({
        companyName: values.companyName.trim(),
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        phone: values.phone.trim() || undefined,
        password: values.password,
      });
      // AppContent moves an authenticated user to /app.
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'We could not create your account. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fieldError = (f: Field) =>
    touched[f] && errors[f] ? (
      <p id={`${f}-error`} className="mt-1 text-[11px] font-medium text-danger-600">{errors[f]}</p>
    ) : null;

  const inputProps = (f: Field) => ({
    id: f,
    value: values[f],
    onChange: set(f),
    onBlur: blur(f),
    'aria-invalid': Boolean(touched[f] && errors[f]),
    'aria-describedby': touched[f] && errors[f] ? `${f}-error` : undefined,
    className: `form-input${touched[f] && errors[f] ? ' border-danger-500' : ''}`,
  });

  return (
    <div className="app-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80" aria-label="Skyhook home">
            <div className="flex h-12 w-[4.75rem] items-center justify-center overflow-hidden rounded-lg border border-line bg-surface p-0.5">
              <BrandLogo className="h-full w-full scale-[1.18]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-ink-900">SKYHOOK</span>
              <span className="badge badge-brand uppercase">ERP System</span>
            </div>
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/login')}>
            Sign in
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5 lg:pt-6">
            <span className="eyebrow">
              <Building2 className="h-3.5 w-3.5" />
              New company workspace
            </span>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
              Set up Skyhook for your crane business
            </h1>
            <p className="text-sm leading-relaxed text-ink-500">
              You become the owner of a new, empty workspace. Add projects, operators and machines,
              then invite your site managers from Settings.
            </p>
            <ol className="space-y-2.5 text-sm text-ink-600">
              <li className="flex gap-3"><span className="font-mono text-xs text-ink-400">01</span>Create your owner account</li>
              <li className="flex gap-3"><span className="font-mono text-xs text-ink-400">02</span>Add sites, crew and fleet</li>
              <li className="flex gap-3"><span className="font-mono text-xs text-ink-400">03</span>Invite managers to mark attendance</li>
            </ol>
          </div>

          <div className="card lg:col-span-7">
            <div className="card-header">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink-900">Create your account</h2>
                <p className="mt-0.5 text-xs text-ink-500">All fields except phone are required</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <UserPlus className="h-5 w-5" />
              </div>
            </div>

            <form onSubmit={onSubmit} noValidate className="card-pad space-y-4">
              {formError && (
                <div className="alert-banner" role="alert">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{formError}</span>
                </div>
              )}

              <div>
                <label htmlFor="companyName" className="form-label">Company name</label>
                <input {...inputProps('companyName')} autoComplete="organization" placeholder="Patel Crane Services" />
                {fieldError('companyName')}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="form-label">Your full name</label>
                  <input {...inputProps('name')} autoComplete="name" placeholder="Ramesh Patel" />
                  {fieldError('name')}
                </div>
                <div>
                  <label htmlFor="phone" className="form-label">Phone <span className="font-normal text-ink-400">(optional)</span></label>
                  <input {...inputProps('phone')} type="tel" autoComplete="tel" placeholder="+91 98250 41736" />
                  {fieldError('phone')}
                </div>
              </div>

              <div>
                <label htmlFor="email" className="form-label">Work email</label>
                <input {...inputProps('email')} type="email" autoComplete="email" placeholder="you@company.in" />
                {fieldError('email')}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className="form-label">Password</label>
                  <div className="relative">
                    <input
                      {...inputProps('password')}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className={`${inputProps('password').className} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-400 hover:text-ink-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldError('password')}
                </div>
                <div>
                  <label htmlFor="confirm" className="form-label">Confirm password</label>
                  <input
                    {...inputProps('confirm')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Repeat password"
                  />
                  {fieldError('confirm')}
                </div>
              </div>

              <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
                {isLoading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    <span>Creating workspace…</span>
                  </>
                ) : (
                  <>
                    <span>Create account</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <p className="text-center text-xs text-ink-500">
                Already have an account?{' '}
                <a
                  href="/login"
                  onClick={(e) => { e.preventDefault(); navigate('/login'); }}
                  className="font-semibold text-ink-800 underline decoration-line-strong underline-offset-2 hover:text-brand-700"
                >
                  Sign in
                </a>
              </p>
            </form>
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-surface px-6 py-3 text-center text-[11px] text-ink-500">
        <a href="/" className="font-semibold text-ink-700 underline decoration-line-strong underline-offset-2 hover:text-brand-700">
          Back to site
        </a>
        <span className="mx-2 text-line-strong">&middot;</span>
        SKYHOOK ERP &middot; Crane business management
      </footer>
    </div>
  );
};
