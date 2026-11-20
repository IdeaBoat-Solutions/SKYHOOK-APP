/**
 * Skyhook landing showcases.
 *
 * Authored Stageshow illustrations, not browser captures. Each scene is one
 * believable screen with one thing happening, framed with a hard crop, one
 * amber accent, and a result that stays on screen. Every scene plays once when
 * it enters the viewport and holds the payoff; reduced motion sees the payoff
 * as a still. Nothing here is a real control.
 */
import {
  Avatar,
  Badge,
  Bar,
  Button,
  Card,
  Count,
  Divider,
  Icon,
  Meter,
  Row,
  Stage,
  States,
  Text,
  Toast,
  Window,
  type Act,
  type Script,
} from '../../stageshow/kit'
import './showcases.css'

/* The shows read the same accent token as the rest of the site. */
const ACCENT = 'var(--color-accent)'

type Beat = { on: boolean }
const before: Beat = { on: false }
const after: Beat = { on: true }

/** A scene with no cursor: one quiet state change, then it holds. */
const beat = (delay: number): Script<Beat> => async (a) => {
  await a.wait(delay)
  await a.set({ on: true })
  await a.wait(1500)
}

/** A scene where the cursor arrives, presses one control, and the result lands. */
const press = (target: string, delay = 650): Script<Beat> => async (a) => {
  await a.wait(delay)
  a.mark('enter')
  await a.enter(target)
  await a.wait(200)
  a.mark('press')
  await a.click()
  await a.set({ on: true })
  a.mark('result')
  await a.wait(1700)
}

/* ------------------------------------------------------------------ *
 * Hero: the month-end payroll run, locked.
 * One window, corner-bleeding off the hero. The sidebar identifies the
 * product, one row is real, the rest is filler, and the action resolves
 * into a status and a toast. The amount is the one big thing on screen.
 * ------------------------------------------------------------------ */

type Hero = { locked: boolean }
const heroBefore: Hero = { locked: false }
const heroAfter: Hero = { locked: true }

const heroScript: Script<Hero> = async (a) => {
  await a.wait(750)
  a.mark('approach')
  await a.enter('lock')
  await a.wait(260)
  a.mark('lock')
  await a.click()
  await a.set({ locked: true })
  a.mark('done')
  await a.wait(2000)
}

const NAV = [
  { icon: 'home' as const, label: 'Dashboard' },
  { icon: 'user' as const, label: 'Workforce' },
  { icon: 'calendar' as const, label: 'Attendance' },
  { icon: 'card' as const, label: 'Payroll' },
  { icon: 'bell' as const, label: 'Alerts' },
]

function PayrollLine({ real }: { real?: boolean }) {
  return (
    <div className="hp-row" data-real={real || undefined}>
      {real ? (
        <>
          <span className="hp-who"><Avatar name="Rajesh Kumar" size={22} /><Text>Rajesh Kumar</Text></span>
          <Text>26</Text>
          <Badge tone="neutral">Ready</Badge>
        </>
      ) : (
        <>
          <span className="hp-who"><Bar w={22} h={22} r={11} tone={2} /><Bar w={82} h={6} tone={3} /></span>
          <Bar w={18} h={6} tone={3} />
          <Bar w={54} h={18} r={9} tone={2} />
        </>
      )}
    </div>
  )
}

export function HeroShowcase() {
  return (
    <Stage<Hero>
      className="lp-hero-stage"
      width={580}
      height={400}
      compact={{ below: 560, width: 358, height: 380 }}
      initial={heroBefore}
      poster={heroAfter}
      play="once"
      script={heroScript}
      cursor={{ at: { wide: { x: 58, y: 352 }, compact: { x: 34, y: 340 } }, ripple: true }}
      accent={ACCENT}
      fidelity="standard"
      greys="cool"
      fill
    >
      {(s, _rect, layout) => {
        const wide = layout === 'wide'
        return (
          <>
            <Window
              className="hp-window"
              title="Payroll · October 2026"
              sidebarWidth={wide ? 122 : 98}
              body={{ className: 'hp-body' }}
              sidebar={
                <nav className="hp-nav">
                  {NAV.map((item) => (
                    <span key={item.label} className="hp-nav__item" data-active={item.label === 'Payroll' || undefined}>
                      <Icon name={item.icon} size={13} filled={item.label === 'Payroll'} />
                      {item.label === 'Payroll' ? <Text>Payroll</Text> : <Bar w={wide ? 66 : 52} h={6} tone={3} />}
                    </span>
                  ))}
                </nav>
              }
              toolbar={<Avatar name="Asha Kulkarni" size={20} tone="ink" />}
            >
              <div className="hp-table">
                <div className="hp-row hp-row--head">
                  <span>Operator</span><span>Days</span><span>Status</span>
                </div>
                <PayrollLine real />
                <PayrollLine />
                <PayrollLine />
                <PayrollLine />
                <Divider className="hp-rule" />
              </div>
              <div className="hp-foot">
                <span className="hp-label">Net payable · 18 operators</span>
                <span className="hp-amount">₹24,600</span>
                <Button
                  variant="primary"
                  size="large"
                  data-target="lock"
                  icon={s.locked ? <Icon name="check" size={13} /> : undefined}
                >
                  <States
                    value={s.locked ? 'done' : 'ask'}
                    states={{ ask: 'Lock run', done: 'Run locked' }}
                  />
                </Button>
              </div>
            </Window>
            <Toast className="hp-toast" show={s.locked} icon={<Icon name="check" size={13} />}>
              18 payslips generated
            </Toast>
          </>
        )
      }}
    </Stage>
  )
}

/* ------------------------------------------------------------------ *
 * Capability bento. Six different kinds of screen, one window between
 * them all, each pinned to the bottom of its tile and cropped hard.
 * ------------------------------------------------------------------ */

function Show({ kind, title, body, children }: {
  kind: string
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <article className={`lp-show lp-show--${kind}`}>
      <div className="lp-show__copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="lp-show__pic" aria-hidden="true">{children}</div>
    </article>
  )
}

/** Sites: a project list whose active count settles as the scene lands. */
export function SitesShowcase() {
  return (
    <Show kind="sites" title="Projects & sites" body="Client sites, contract values and the overtime rate that applies on each one.">
      <Stage<Beat> className="lp-tile-stage" fill width={360} height={320} initial={before} poster={after} play="once" script={beat(520)} accent={ACCENT}>
        {(s) => (
          <Window className="lp-tile-window lp-tile-window--wide" title="Projects" body={{ className: 'lp-pad' }}>
            <div className="lp-projects">
              <Row
                lead={<span className="lp-tile-icon"><Icon name="home" size={13} filled /></span>}
                title={<Text>Harbour Rd Flyover</Text>}
                subtitle={<Bar w={98} h={6} tone={3} />}
                meta={<Badge tone="accent">Live</Badge>}
                selected
              />
              <Row lead={<Bar w={26} h={26} r={7} tone={2} />} title={<Bar w={116} h={6} tone={3} />} subtitle={<Bar w={72} h={6} tone={2} />} />
              <Row lead={<Bar w={26} h={26} r={7} tone={2} />} title={<Bar w={92} h={6} tone={3} />} subtitle={<Bar w={104} h={6} tone={2} />} />
              <Row lead={<Bar w={26} h={26} r={7} tone={2} />} title={<Bar w={108} h={6} tone={3} />} subtitle={<Bar w={76} h={6} tone={2} />} />
              <Divider />
              <div className="lp-projects__foot">
                <span>Active sites</span>
                <strong><Count value={s.on ? 3 : 0} duration={850} /></strong>
                <Meter value={s.on ? 0.62 : 0.08} />
              </div>
            </div>
          </Window>
        )}
      </Stage>
    </Show>
  )
}

/** Workforce: one operator's licence gets verified. */
export function WorkforceShowcase() {
  return (
    <Show kind="workforce" title="Workforce master" body="Operators and staff with pay rates, licence dates and documents in one record.">
      <Stage<Beat> className="lp-tile-stage" fill width={360} height={320} initial={before} poster={after} play="once" script={press('verify', 760)} cursor={{ at: { x: 26, y: 272 }, ripple: true }} accent={ACCENT}>
        {(s) => (
          <Window className="lp-tile-window lp-tile-window--wide" title="Operator record" body={{ className: 'lp-pad' }}>
            <div className="lp-record">
              <div className="lp-record__who">
                <Avatar name="Priya Nair" size={34} tone="accent" />
                <span>
                  <Text>Priya Nair</Text>
                  <Bar w={88} h={6} tone={3} />
                </span>
              </div>
              <Divider />
              <div className="lp-record__row">
                <span>Licence</span>
                <States
                  value={s.on ? 'ok' : 'warn'}
                  states={{
                    warn: <Badge tone="warning" dot>Expires in 12 days</Badge>,
                    ok: <Badge tone="success" icon={<Icon name="check" size={11} />}>Verified</Badge>,
                  }}
                  align="end"
                />
              </div>
              <div className="lp-record__row">
                <span>Documents</span>
                <span className="lp-record__checks"><Icon name="check" size={12} /><Icon name="check" size={12} /><Icon name="check" size={12} /></span>
              </div>
              <div className="lp-record__row"><span>Pay rate</span><Bar w={52} h={6} tone={3} /></div>
              <div className="lp-record__row"><span>Bank</span><Bar w={66} h={6} tone={3} /></div>
              <Button size="small" variant={s.on ? 'secondary' : 'primary'} data-target="verify">
                <States value={s.on ? 'done' : 'ask'} states={{ ask: 'Verify', done: 'Verified' }} />
              </Button>
            </div>
          </Window>
        )}
      </Stage>
    </Show>
  )
}

/** Attendance: a submitted day is approved and its overtime enters the run. */
export function AttendanceShowcase() {
  return (
    <Show kind="attendance" title="Attendance & overtime" body="Daily presence, hours and day-wise overtime captured at the site, then approved.">
      <Stage<Beat> className="lp-tile-stage" fill width={720} height={320} initial={before} poster={after} play="once" script={press('approve', 620)} cursor={{ at: { x: 34, y: 276 }, ripple: true }} accent={ACCENT}>
        {(s) => (
          <Window className="lp-tile-window lp-tile-window--hero" title="Timesheet · Week 42" body={{ className: 'lp-pad' }}>
            <div className="lp-timesheet">
              <div className="lp-ts-head"><span>Operator</span><span>Days</span><span>OT</span><span>Status</span></div>
              <div className="lp-ts-row lp-ts-row--real">
                <span className="lp-ts-who"><Avatar name="Rajesh Kumar" size={22} /><Text>Rajesh Kumar</Text></span>
                <Text>26</Text><Text>6 h</Text>
                <States
                  value={s.on ? 'ok' : 'wait'}
                  states={{ wait: <Badge tone="warning" dot>Pending</Badge>, ok: <Badge tone="success" icon={<Icon name="check" size={11} />}>Approved</Badge> }}
                />
              </div>
              <div className="lp-ts-row"><Bar w={104} h={6} tone={3} /><Bar w={16} h={6} tone={3} /><Bar w={22} h={6} tone={3} /><Bar w={58} h={18} r={9} tone={2} /></div>
              <div className="lp-ts-row"><Bar w={88} h={6} tone={3} /><Bar w={18} h={6} tone={3} /><Bar w={26} h={6} tone={3} /><Bar w={54} h={18} r={9} tone={2} /></div>
              <Divider />
              <div className="lp-ts-foot">
                <span>Overtime in the run</span>
                <strong><Count value={s.on ? 18 : 12} duration={700} /> h</strong>
                <Button variant="primary" size="small" data-target="approve">
                  <States value={s.on ? 'done' : 'ask'} states={{ ask: 'Approve day', done: 'Approved' }} />
                </Button>
              </div>
            </div>
          </Window>
        )}
      </Stage>
    </Show>
  )
}

/** Payroll: a payslip is generated from the approved run. */
export function PayrollShowcase() {
  return (
    <Show kind="payslip" title="Automated payroll" body="Monthly runs built from approved attendance, with advances recovered and slips ready.">
      <Stage<Beat> className="lp-tile-stage" fill width={360} height={320} initial={before} poster={after} play="once" script={press('slip', 900)} cursor={{ at: { x: 26, y: 272 }, ripple: true }} accent={ACCENT}>
        {(s) => (
          <>
            <Window className="lp-tile-window lp-tile-window--wide" title="Payslip · Oct 2026" body={{ className: 'lp-pad' }}>
              <div className="lp-slip">
                <div className="lp-slip__name"><Avatar name="Rajesh Kumar" size={26} /><Text>Rajesh Kumar</Text></div>
                <div className="lp-slip__row"><span>26 days</span><Bar w={54} h={6} tone={3} /></div>
                <div className="lp-slip__row"><span>6 h overtime</span><Bar w={42} h={6} tone={3} /></div>
                <div className="lp-slip__row"><span>Advance recovered</span><Bar w={38} h={6} tone={3} /></div>
                <Divider />
                <div className="lp-slip__net"><span>Net payable</span><strong>₹<Count value={s.on ? 24600 : 23150} duration={800} format={(n) => Math.round(n).toLocaleString('en-IN')} /></strong></div>
                <Button size="small" variant="primary" data-target="slip" icon={<Icon name="file" size={12} />}>
                  <States value={s.on ? 'done' : 'ask'} states={{ ask: 'Download slip', done: 'Downloaded' }} />
                </Button>
              </div>
            </Window>
            <Toast className="lp-tile-toast" show={s.on} icon={<Icon name="check" size={12} />}>Payslip ready</Toast>
          </>
        )}
      </Stage>
    </Show>
  )
}

/** Compliance: an insurance renewal clears the red alert. */
export function ComplianceShowcase() {
  return (
    <Show kind="compliance" title="Crane compliance" body="Service, insurance, PUC and fitness dates tracked per machine before they lapse.">
      <Stage<Beat> className="lp-tile-stage" fill width={360} height={320} initial={before} poster={after} play="once" script={press('renew', 1020)} cursor={{ at: { x: 26, y: 272 }, ripple: true }} accent={ACCENT}>
        {(s) => (
          <Window className="lp-tile-window lp-tile-window--wide" title="Machine MH-2847" body={{ className: 'lp-pad' }}>
            <div className="lp-machine">
              <div className="lp-machine__head">
                <span className="lp-machine__icon"><Icon name="bolt" size={17} filled /></span>
                <span><Text>Tower crane</Text><Bar w={74} h={6} tone={3} /></span>
              </div>
              <Divider />
              <div className="lp-machine__row"><span>Insurance</span>
                <States
                  value={s.on ? 'ok' : 'warn'}
                  states={{ warn: <Badge tone="danger" dot>Due in 6 days</Badge>, ok: <Badge tone="success">Renewed · Apr 2027</Badge> }}
                  align="end"
                />
              </div>
              <div className="lp-machine__row"><span>Fitness</span><Badge tone="success">Valid</Badge></div>
              <div className="lp-machine__row"><span>PUC</span><Bar w={58} h={6} tone={3} /></div>
              <div className="lp-machine__row"><span>Last service</span><Bar w={70} h={6} tone={3} /></div>
              <Button size="small" variant={s.on ? 'secondary' : 'primary'} data-target="renew">
                <States value={s.on ? 'done' : 'ask'} states={{ ask: 'Renew now', done: 'Renewed' }} />
              </Button>
            </div>
          </Window>
        )}
      </Stage>
    </Show>
  )
}

/** Alerts: the overdue list exports straight to Excel. */
export function AlertsShowcase() {
  return (
    <Show kind="alerts" title="Red alerts & reports" body="Overdue and due-today obligations surfaced first, then exported in the columns already in the system.">
      <Stage<Beat> className="lp-tile-stage" fill width={720} height={320} initial={before} poster={after} play="once" script={press('export', 1150)} cursor={{ at: { x: 34, y: 252 }, ripple: true }} accent={ACCENT}>
        {(s) => (
          <>
            <Window className="lp-tile-window lp-tile-window--strip" title="Due & overdue" body={{ className: 'lp-pad' }}>
              <div className="lp-alerts">
                <div className="lp-alert lp-alert--real">
                  <span className="lp-alert__icon"><Icon name="bell" size={13} filled /></span>
                  <Text>PUC overdue · MH-2847</Text>
                  <Bar w={120} h={6} tone={2} />
                  <Badge tone="danger">Overdue</Badge>
                </div>
                <div className="lp-alert"><Bar w={18} h={18} r={9} tone={2} /><Bar w={164} h={6} tone={3} /><Bar w={96} h={6} tone={2} /><Bar w={54} h={18} r={9} tone={2} /></div>
                <div className="lp-alert"><Bar w={18} h={18} r={9} tone={2} /><Bar w={128} h={6} tone={3} /><Bar w={104} h={6} tone={2} /><Bar w={48} h={18} r={9} tone={2} /></div>
                <div className="lp-alert"><Bar w={18} h={18} r={9} tone={2} /><Bar w={150} h={6} tone={3} /><Bar w={88} h={6} tone={2} /><Bar w={52} h={18} r={9} tone={2} /></div>
                <Button variant="primary" size="small" data-target="export" icon={<Icon name="file" size={12} />}>
                  <States value={s.on ? 'done' : 'ask'} states={{ ask: 'Export Excel', done: 'Exported' }} />
                </Button>
              </div>
            </Window>
            <Toast className="lp-tile-toast" show={s.on} icon={<Icon name="check" size={12} />}>38 rows exported</Toast>
          </>
        )}
      </Stage>
    </Show>
  )
}

export function CapabilityShowcases() {
  return (
    <>
      <AttendanceShowcase />
      <SitesShowcase />
      <WorkforceShowcase />
      <PayrollShowcase />
      <ComplianceShowcase />
      <AlertsShowcase />
    </>
  )
}
