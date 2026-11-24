import React, { useState } from 'react';
import { LoginForm } from '@/components/login-form';
import { useSkyhook } from '../../data/apiStore';
import { navigate } from '../../lib/nav';
import { BrandLockup } from '../common/BrandLockup';
import { CraneLiftShowcase } from '../../stageshow/CraneLiftShowcase';

/**
 * Credentials-only sign in. The server verifies the email + password against
 * the database and decides the user, tenant and role - the client holds no
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
    <div className="auth-page app-shell">
      <header className="auth-nav">
        <div className="auth-nav-inner">
          <a href="/" className="auth-brand" aria-label="Skyhook home">
            <BrandLockup logoUrl={companySettings.logoUrl} name={companySettings.name} />
          </a>
        </div>
      </header>

      <main className="auth-main">
        <LoginForm
          brandMark={(
            <BrandLockup logoUrl={companySettings.logoUrl} name={companySettings.name} size="card" />
          )}
          media={<CraneLiftShowcase />}
          email={email}
          password={password}
          showPassword={showPassword}
          isLoading={isLoading}
          errorMessage={errorMessage}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onTogglePassword={() => setShowPassword((value) => !value)}
          onSubmit={handleLoginSubmit}
          onRegisterClick={(e) => { e.preventDefault(); navigate('/register'); }}
        />
      </main>

      <footer className="auth-footer">
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); navigate('/'); }}
        >
          Back to site
        </a>
      </footer>
    </div>
  );
};
