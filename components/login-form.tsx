import React from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';

export interface LoginFormProps {
  brandMark: React.ReactNode;
  /** Optional illustration rendered beside the form on wide screens. */
  media?: React.ReactNode;
  email: string;
  password: string;
  showPassword: boolean;
  isLoading: boolean;
  errorMessage: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onRegisterClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Adapted from shadcn's login-04 block. The split-card layout is kept; the
 * social providers, password recovery and legal links from the original are
 * intentionally omitted because this backend has no routes for them.
 */
export function LoginForm({
  brandMark,
  media,
  email,
  password,
  showPassword,
  isLoading,
  errorMessage,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit,
  onRegisterClick,
}: LoginFormProps) {
  return (
    <div className="auth-split">
      <div className="auth-split-form">
        <div className="auth-split-brand">
          {brandMark}
        </div>

        <form onSubmit={onSubmit} className="auth-form" noValidate>
          {errorMessage && (
            <div className="alert-banner" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs">{errorMessage}</span>
            </div>
          )}

          <div className="auth-field">
            <label className="form-label" htmlFor="login-email">Email</label>
            <div className="auth-input-wrap">
              <Mail className="auth-input-icon" aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="name@company.com"
                required
                className="form-input auth-input auth-input--with-icon"
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="form-label" htmlFor="login-password">Password</label>
            <div className="auth-input-wrap">
              <Lock className="auth-input-icon" aria-hidden="true" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="Enter your password"
                required
                className="form-input auth-input auth-input--with-icon auth-input--with-action"
              />
              <button
                type="button"
                onClick={onTogglePassword}
                className="auth-input-action"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn btn-primary auth-submit">
            {isLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Sign in</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <p className="auth-switch">
          New to Skyhook?{' '}
          <a href="/register" onClick={onRegisterClick}>Create an account</a>
        </p>
      </div>

      {media && <div className="auth-split-media">{media}</div>}
    </div>
  );
}
