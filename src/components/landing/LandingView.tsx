import React, { useState } from 'react';
import {
  FolderKanban,
  Users,
  CalendarCheck,
  Calculator,
  Truck,
  BellRing,
  ArrowRight,
  Check,
} from 'lucide-react';

const capabilities = [
  {
    icon: FolderKanban,
    title: 'Projects & sites',
    body: 'Client sites, contract values and the overtime rate that applies on each one.',
  },
  {
    icon: Users,
    title: 'Workforce master',
    body: 'Operators and staff with their pay rates, licence dates and documents in one record.',
  },
  {
    icon: CalendarCheck,
    title: 'Attendance & overtime',
    body: 'Daily presence, hours and day-wise overtime captured at the site, then approved.',
  },
  {
    icon: Calculator,
    title: 'Automated payroll',
    body: 'Monthly runs built from approved attendance, with advances recovered and slips ready.',
  },
  {
    icon: Truck,
    title: 'Crane compliance',
    body: 'Service, insurance, PUC and fitness dates tracked per machine before they lapse.',
  },
  {
    icon: BellRing,
    title: 'Red alerts & reports',
    body: 'Overdue and due-today obligations surfaced first; Excel reports ready to download.',
  },
];

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

const rupees = (value: number) =>
  '\u20B9' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);

/** A working calculation using the same rules as the payroll module. */
const PayrollArtifact: React.FC = () => {
  const [days, setDays] = useState(24);
  const [rate, setRate] = useState(900);
  const [otHours, setOtHours] = useState(4);
  const [otRate, setOtRate] = useState(150);
  const [advance, setAdvance] = useState(2500);

  const gross = days * rate + otHours * otRate;
  const net = gross - advance;

  const fields = [
    { label: 'Payable days', value: days, set: setDays, max: 31 },
    { label: 'Day rate', value: rate, set: setRate, max: 100000 },
    { label: 'OT hours', value: otHours, set: setOtHours, max: 200 },
    { label: 'OT rate / hr', value: otRate, set: setOtRate, max: 10000 },
    { label: 'Advance', value: advance, set: setAdvance, max: 1000000 },
  ];

  return (
    <div className="lp-calc" aria-label="Live payroll calculation">
      <div className="lp-calc__head">
        <span>Live calculation</span>
        <span>October 2026</span>
      </div>
      <div className="lp-calc__fields">
        {fields.map((field) => (
          <label className="lp-field" key={field.label}>
            <span>{field.label}</span>
            <input
              type="number"
              min={0}
              max={field.max}
              value={field.value}
              onChange={(event) =>
                field.set(Math.min(field.max, Math.max(0, Number(event.target.value) || 0)))
              }
            />
          </label>
        ))}
      </div>
      <div className="lp-calc__result">
        <span>Net payable</span>
        <strong>{rupees(net)}</strong>
        <p>
          {days} days at {rupees(rate)} plus {otHours} hours at {rupees(otRate)}, less {rupees(advance)} advance
        </p>
      </div>
    </div>
  );
};

interface LandingViewProps {
  onEnter: () => void;
  onRegister?: () => void;
}

/** Public landing page — static, token-matched, no motion. Product explained in one screen. */
export const LandingView: React.FC<LandingViewProps> = ({ onEnter, onRegister }) => {
  return (
    <div className="landing">
      <a className="landing-skip visually-hidden" href="#landing-main">
        Skip to main content
      </a>

      <header className="landing-header">
        <nav className="landing-nav" aria-label="Primary">
          <div className="landing-brand">
            <span className="landing-brand__name">SKYHOOK</span>
            <span className="landing-brand__tag">ERP</span>
            <span className="landing-brand__divider" aria-hidden="true" />
            <span className="landing-brand__tagline">Elevating Crane Operations.</span>
          </div>
          <div className="landing-nav__actions">
            <a className="landing-link" href="#capabilities">What it does</a>
            <button type="button" className="landing-btn landing-btn--light" onClick={onEnter}>
              Sign in
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
            <div className="landing-hero__artifact">
              <PayrollArtifact />
            </div>
          </div>
        </section>

        <section id="capabilities" className="landing-section" aria-labelledby="capabilities-title">
          <div className="landing-section__head">
            <h2 id="capabilities-title" className="landing-section__title">Six jobs, one place to do them.</h2>
            <p className="landing-section__sub">Thirteen connected modules. Two roles. One source of truth.</p>
          </div>
          <ul className="landing-feature-grid">
            {capabilities.map(({ icon: Icon, title, body }) => (
              <li key={title} className="landing-feature">
                <Icon className="landing-feature__icon" aria-hidden="true" />
                <h3 className="landing-feature__title">{title}</h3>
                <p className="landing-feature__body">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section landing-section--muted" aria-labelledby="flow-title">
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

        <section className="landing-section landing-section--muted" aria-labelledby="roles-title">
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

        <section className="landing-section" aria-labelledby="faq-title">
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

      <footer className="landing-footer">
        <span>SKYHOOK ERP · Crane Business Management System</span>
        <span>Internal enterprise system · Asia/Kolkata</span>
      </footer>
    </div>
  );
};
