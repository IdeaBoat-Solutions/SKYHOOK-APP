import React, { useState } from 'react';
import { ArrowRight, Check, Moon, Sun } from 'lucide-react';
import { CapabilityShowcases, HeroShowcase } from './showcases';

const questions = [
  {
    q: 'Does it handle more than one project per operator?',
    a: 'Yes. Hours are recorded against each site, and each site carries its own overtime rate. One operator can split a day across projects and the totals still reconcile.',
  },
  {
    q: 'How are salary advances recovered?',
    a: 'An approved advance is attached to the operator and deducted from the next payroll run. The deduction appears on the payslip with the opening and closing balance.',
  },
  {
    q: 'Can managers approve anything?',
    a: 'Managers can submit attendance, working hours and expenses. Final approval, role changes and the payroll lock stay with the owner.',
  },
  {
    q: 'What happens when a document expires?',
    a: 'Insurance, PUC, fitness, service and licence dates are checked against the current date. Due and overdue items appear as red alerts with a direct renewal action.',
  },
  {
    q: 'Can we export the data?',
    a: 'Payroll, attendance and compliance reports export to Excel using the columns already in the system, so no reformatting is needed.',
  },
  {
    q: 'Where does the data live?',
    a: 'The API runs on PostgreSQL. It can use a local database in development or Supabase for database, authentication and document storage in production.',
  },
];

interface LandingViewProps {
  onEnter: () => void;
  onRegister?: () => void;
}

/** Public landing page — static, token-matched, no motion. Product explained in one screen. */
export const LandingView: React.FC<LandingViewProps> = ({ onEnter, onRegister }) => {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('skyhook-landing-theme') === 'dark';
  });

  const toggleTheme = () => {
    setDark((was) => {
      window.localStorage.setItem('skyhook-landing-theme', was ? 'light' : 'dark');
      return !was;
    });
  };

  return (
    <div className={`landing${dark ? ' landing--dark' : ''}`}>
      <a className="landing-skip visually-hidden" href="#landing-main">
        Skip to main content
      </a>

      <header className="landing-header">
        <nav className="landing-nav" aria-label="Primary">
          <a className="landing-brand" href="#landing-main">
            <img className="landing-brand__mark" src="/assets/image.png" alt="" aria-hidden="true" />
            <span className="landing-brand__name">Skyhook</span>
            <span className="landing-brand__tag">ERP</span>
          </a>
          <nav className="landing-nav__links" aria-label="Sections">
            <a href="#capabilities">What it does</a>
            <a href="#flow">The flow</a>
            <a href="#roles">Roles</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="landing-nav__actions">
            <button
              type="button"
              className="landing-theme-toggle"
              onClick={toggleTheme}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={dark ? 'Light theme' : 'Dark theme'}
            >
              {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <button type="button" className="landing-btn landing-btn--accent" onClick={onEnter}>
              Open the ERP
            </button>
          </div>
        </nav>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__inner">
            <div className="landing-hero__copy">
              <p className="landing-eyebrow">ERP for crane hire &amp; heavy-lift operators</p>
              <h1 id="landing-title" className="landing-title">
                One ledger for every<br />
                crane, operator and site.
              </h1>
              <p className="landing-lede">
                Site attendance, project overtime, payroll, EMIs and statutory renewals in one place.
                Wages come out right, and no insurance or PUC date slips past.
              </p>
              <div className="landing-hero__actions">
                <button type="button" className="landing-btn landing-btn--light" onClick={onEnter}>
                  Open the ERP
                </button>
                <a className="landing-link landing-link--light" href="#capabilities">
                  See what it handles
                </a>
                {onRegister && (
                  <button type="button" className="landing-link landing-link--light landing-link--button" onClick={onRegister}>
                    Create account
                  </button>
                )}
              </div>
            </div>
            <div className="landing-hero__artifact" aria-hidden="true">
              <HeroShowcase />
            </div>
          </div>
        </section>

        <section id="capabilities" className="landing-section" aria-labelledby="capabilities-title">
          <div className="landing-section__head">
            <h2 id="capabilities-title" className="landing-section__title">Six jobs, one place to do them.</h2>
            <p className="landing-section__sub">Thirteen connected modules. Two roles. One source of truth.</p>
          </div>
          <div className="landing-show-grid">
            <CapabilityShowcases />
          </div>
        </section>

        <section id="flow" className="landing-section landing-section--muted" aria-labelledby="flow-title">
          <div className="landing-section__head">
            <h2 id="flow-title" className="landing-section__title">The same close, every month.</h2>
            <p className="landing-section__sub">The same flow every month, without the spreadsheets.</p>
          </div>
          <ol className="landing-steps">
            <li>
              <span className="landing-step__no">01</span>
              <div>
                <h3>Record the day</h3>
                <p>Mark attendance, hours and project-wise overtime for each operator.</p>
              </div>
            </li>
            <li>
              <span className="landing-step__no">02</span>
              <div>
                <h3>Review and approve</h3>
                <p>Managers submit; the owner approves attendance, expenses and the final payroll run.</p>
              </div>
            </li>
            <li>
              <span className="landing-step__no">03</span>
              <div>
                <h3>Pay and stay ahead</h3>
                <p>Advances are recovered, slips are printed, and renewal alerts keep the fleet running.</p>
              </div>
            </li>
          </ol>
        </section>

        <section id="roles" className="landing-section landing-section--muted" aria-labelledby="roles-title">
          <div className="landing-section__head">
            <h2 id="roles-title" className="landing-section__title">Built around who signs off.</h2>
            <p className="landing-section__sub">Two roles, clearly scoped. Everyone sees what they need and nothing they do not.</p>
          </div>
          <div className="landing-roles">
            <article className="landing-role landing-role--owner">
              <span className="landing-role__label">Owner</span>
              <h3>The final word stays with you.</h3>
              <p>Lock the payroll run, change roles, approve advances and see every overdue statutory item before anyone else does.</p>
              <ul>
                <li><Check size={14} aria-hidden="true" /> Payroll lock</li>
                <li><Check size={14} aria-hidden="true" /> Role assignment</li>
                <li><Check size={14} aria-hidden="true" /> Full fleet view</li>
              </ul>
            </article>
            <article className="landing-role">
              <span className="landing-role__label">Operations manager</span>
              <h3>Keep the site moving.</h3>
              <p>Mark attendance, log crane hours, raise expenses and submit the month for review without waiting for head office.</p>
              <ul>
                <li><Check size={14} aria-hidden="true" /> Attendance entry</li>
                <li><Check size={14} aria-hidden="true" /> Working hours</li>
                <li><Check size={14} aria-hidden="true" /> Expense vouchers</li>
              </ul>
            </article>
          </div>
        </section>

        <section id="faq" className="landing-section" aria-labelledby="faq-title">
          <div className="landing-section__head">
            <h2 id="faq-title" className="landing-section__title">The questions that come up first.</h2>
          </div>
          <div className="landing-faq">
            {questions.map((item) => (
              <div className="landing-faq__item" key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-cta" aria-labelledby="cta-title">
          <div>
            <h2 id="cta-title">Put the whole business in one view.</h2>
            <p>Sign in to the working ERP and see a full month end to end.</p>
          </div>
          <button type="button" className="landing-btn landing-btn--primary" onClick={onEnter}>
            Open the ERP <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      </main>
    </div>
  );
};
