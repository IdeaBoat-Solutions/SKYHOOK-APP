/** EMI module ported from server/src/modules/emi/emi.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { config } from '../_shared/config.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { json, readJson, routePath } from '../_shared/http.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

/* ----------------------------- validators ----------------------------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function strField(
  b: any, field: string,
  opts: { required?: boolean; minLen?: number; fallback?: string } = {},
): string | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'string') throw Errors.validation([{ field, message: 'Must be a string' }]);
  if (opts.minLen != null && v.length < opts.minLen) {
    throw Errors.validation([{ field, message: `Must be at least ${opts.minLen} characters` }]);
  }
  return v;
}

function numField(
  b: any, field: string,
  opts: { required?: boolean; integer?: boolean; min?: number; max?: number; fallback?: number } = {},
): number | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw Errors.validation([{ field, message: 'Must be a number' }]);
  }
  if (opts.integer && !Number.isInteger(v)) throw Errors.validation([{ field, message: 'Must be an integer' }]);
  if (opts.min != null && v < opts.min) throw Errors.validation([{ field, message: `Must be >= ${opts.min}` }]);
  if (opts.max != null && v > opts.max) throw Errors.validation([{ field, message: `Must be <= ${opts.max}` }]);
  return v;
}

function enumField<T extends string>(
  b: any, field: string, allowed: readonly T[],
  opts: { required?: boolean; fallback?: T } = {},
): T | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw Errors.validation([{ field, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return v as T;
}

function uuidField(b: any, field: string): string {
  const v = strField(b, field, { required: true })!;
  if (!UUID_RE.test(v)) throw Errors.validation([{ field, message: 'Must be a valid UUID' }]);
  return v;
}

function idFromPath(req: Request): string {
  return routePath(req).split('/').filter(Boolean)[1] ?? '';
}

function validateLoan(b: any) {
  return {
    assetId: uuidField(b, 'assetId'),
    loanProvider: strField(b, 'loanProvider', { required: true, minLen: 1 })!,
    loanRefNumber: strField(b, 'loanRefNumber', { required: true, minLen: 1 })!,
    loanStartDate: strField(b, 'loanStartDate', { required: true })!,
    monthlyDueDay: numField(b, 'monthlyDueDay', { required: true, integer: true, min: 1, max: 28 })!,
    principalPaise: numField(b, 'principalPaise', { required: true, integer: true, min: 1 })!,
    annualInterestPct: numField(b, 'annualInterestPct', { min: 0, fallback: 0 })!,
    tenureMonths: numField(b, 'tenureMonths', { required: true, integer: true, min: 1, max: 120 })!,
    reminderLeadDays: numField(b, 'reminderLeadDays', { required: true, integer: true, min: 0, fallback: 15 })!,
  };
}

/* ------------------------ calculations / helpers ----------------------- */
function businessDate(): string {
  return config.DEMO_DATE ?? new Date().toISOString().split('T')[0]!;
}

function evaluateReminderStatus(
  dueDateStr: string | null | undefined,
  leadDays: number,
  currentDateStr: string,
): { daysRemaining: number; status: 'overdue' | 'due_today' | 'upcoming' | 'none'; label: string } {
  if (!dueDateStr) return { daysRemaining: 9999, status: 'none', label: 'No Due Date' };
  const due = new Date(dueDateStr);
  const curr = new Date(currentDateStr);
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysRemaining = Math.round((utc(due) - utc(curr)) / 86_400_000);
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return { daysRemaining, status: 'overdue', label: `Overdue by ${n} Day${n === 1 ? '' : 's'}` };
  }
  if (daysRemaining === 0) return { daysRemaining, status: 'due_today', label: 'Due Today' };
  if (daysRemaining <= leadDays) {
    return { daysRemaining, status: 'upcoming', label: `Due in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'}` };
  }
  return { daysRemaining, status: 'none', label: `Scheduled (${daysRemaining} days away)` };
}

interface EmiInstallmentPlan {
  number: number;
  dueDate: string;
  principalPaise: number;
  interestPaise: number;
  amountPaise: number;
  balancePaise: number;
}

/** Standard reducing-balance amortization: EMI = P·r·(1+r)^n / ((1+r)^n − 1). */
function calculateEmi(principalPaise: number, annualRatePct: number, months: number, startDate: string, dueDay: number) {
  const p = principalPaise;
  const r = annualRatePct / 12 / 100;
  const n = months;
  const emiPaise = r === 0 ? Math.round(p / n) : Math.round((p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  const schedule: EmiInstallmentPlan[] = [];
  let balance = p;
  for (let i = 1; i <= n; i++) {
    const interestPaise = Math.round(balance * r);
    const principalPart = Math.min(balance, emiPaise - interestPaise);
    balance -= principalPart;
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    d.setDate(dueDay);
    schedule.push({
      number: i,
      dueDate: d.toISOString().split('T')[0]!,
      principalPaise: principalPart,
      interestPaise,
      amountPaise: principalPart + interestPaise,
      balancePaise: Math.max(0, balance),
    });
  }
  return {
    emiPaise,
    totalInterestPaise: schedule.reduce((s, x) => s + x.interestPaise, 0),
    totalPayablePaise: schedule.reduce((s, x) => s + x.amountPaise, 0),
    schedule,
  };
}

interface AuditInput {
  action: string;
  entity: string;
  entityId: string;
  reason?: string;
  previousValue?: unknown;
  updatedValue?: unknown;
  requestId?: string;
}

async function writeAudit(c: Queryable, auth: AuthContext, input: AuditInput): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_name, action, entity, entity_id,
                             previous_value, updated_value, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      auth.tenantId,
      auth.userId,
      auth.name,
      input.action,
      input.entity,
      input.entityId,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.updatedValue === undefined ? null : JSON.stringify(input.updatedValue),
      input.reason ?? null,
      input.requestId ?? null,
    ],
  );
  await c.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      auth.tenantId,
      input.action,
      input.entity,
      input.entityId,
      JSON.stringify({ reason: input.reason ?? null, at: new Date().toISOString() }),
    ],
  );
}

interface IdempotentResult<T> { statusCode: number; body: T }

/** Executes a mutating operation at most once per (tenant, key, endpoint). */
async function idempotent<T>(
  tenantId: string,
  key: string,
  endpoint: string,
  requestHash: string,
  handler: (c: Queryable) => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  return withTenant(tenantId, async (c) => {
    const hit = await c.query(
      `SELECT status_code, response_body FROM idempotency_keys
       WHERE tenant_id = $1 AND key = $2 AND endpoint = $3 AND expires_at > now()`,
      [tenantId, key, endpoint],
    );
    if (hit.rows[0]) {
      return {
        statusCode: hit.rows[0].status_code as number,
        body: hit.rows[0].response_body as T,
      };
    }

    const result = await handler(c);
    await c.query(
      `INSERT INTO idempotency_keys
         (tenant_id, key, endpoint, request_hash, status_code, response_body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       ON CONFLICT (tenant_id, key, endpoint) DO NOTHING`,
      [tenantId, key, endpoint, requestHash, result.statusCode, JSON.stringify(result.body)],
    );
    return result;
  });
}

function idem(req: Request): string {
  return req.headers.get('idempotency-key') ?? crypto.randomUUID();
}

async function hash(b: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(b ?? {}));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const emiRoutes: Route[] = [
  {
    method: 'POST', path: '/emi/calculate',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:read');
      const b = validateLoan(await readJson(req));
      const r = calculateEmi(b.principalPaise, b.annualInterestPct, b.tenureMonths, b.loanStartDate, b.monthlyDueDay);
      return json({
        emiPaise: r.emiPaise, totalInterestPaise: r.totalInterestPaise,
        totalPayablePaise: r.totalPayablePaise, schedule: r.schedule.slice(0, 5),
      });
    },
  },
  {
    method: 'GET', path: '/emi-loans',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:read');
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT l.*, m.asset_code, (SELECT count(*)::int FROM emi_installments i WHERE i.loan_id=l.id AND i.status<>'paid') AS pending
           FROM emi_loans l JOIN machines m ON m.id=l.machine_id
           WHERE l.tenant_id=$1 ORDER BY l.loan_code`,
          [auth.tenantId],
        );
        return { items: r.rows };
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/emi-loans/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:read');
      const id = idFromPath(req);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const loan = await c.query('SELECT * FROM emi_loans WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!loan.rows[0]) throw Errors.notFound('EMI loan');
        const inst = await c.query('SELECT * FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 ORDER BY installment_number', [auth.tenantId, id]);
        return { ...loan.rows[0], installments: inst.rows };
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/emi-loans',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:write');
      const b = validateLoan(await readJson(req));
      const created = await withTenant(auth.tenantId, async (c) => {
        const plan = calculateEmi(b.principalPaise, b.annualInterestPct, b.tenureMonths, b.loanStartDate, b.monthlyDueDay);
        const today = businessDate();
        const initialPaid = plan.schedule.filter((s) => s.dueDate < today).length;
        const nextDate = plan.schedule.find((s) => s.dueDate >= today)?.dueDate ?? plan.schedule[plan.schedule.length - 1]!.dueDate;
        const seq = await c.query('SELECT count(*)::int n FROM emi_loans WHERE tenant_id=$1', [auth.tenantId]);
        const code = `LOAN-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
        const loan = await c.query(
          `INSERT INTO emi_loans (tenant_id,loan_code,machine_id,loan_provider,loan_ref_number,loan_start_date,
            loan_end_date,emi_amount_paise,monthly_due_day,total_installments,installments_paid,next_emi_date,reminder_lead_days,created_by)
           VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12::date,$13,$14) RETURNING *`,
          [auth.tenantId, code, b.assetId, b.loanProvider, b.loanRefNumber, b.loanStartDate,
            plan.schedule[plan.schedule.length - 1]!.dueDate, plan.emiPaise, b.monthlyDueDay,
            b.tenureMonths, initialPaid, nextDate, b.reminderLeadDays, auth.userId],
        );
        for (const s of plan.schedule) {
          const status = s.dueDate < today ? 'paid' : s.dueDate === today ? 'due_today' : 'upcoming';
          await c.query(
            `INSERT INTO emi_installments (tenant_id,loan_id,installment_number,due_date,amount_due_paise,amount_paid_paise,status)
             VALUES ($1,$2,$3,$4::date,$5,$6,$7::emi_status)`,
            [auth.tenantId, loan.rows[0].id, s.number, s.dueDate, s.amountPaise, status === 'paid' ? s.amountPaise : 0, status],
          );
        }
        await writeAudit(c, auth, { action: 'EMI_LOAN_CREATED', entity: 'MachineEmiLoan', entityId: loan.rows[0].id, reason: `Loan ${code} for machine ${b.assetId}`, requestId: ctx.requestId });
        return { ...loan.rows[0], installments: plan.schedule };
      });
      return json(created, 201);
    },
  },
  {
    method: 'POST', path: '/emi-loans/:id/payments',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:write');
      const id = idFromPath(req);
      const b = await readJson(req);
      const installmentNumber = numField(b, 'installmentNumber', { required: true, integer: true, min: 1 })!;
      const paymentMode = enumField(b, 'paymentMode', ['cash', 'bank_transfer', 'upi', 'cheque', 'company_card'], { required: true })!;
      const paymentReference = strField(b, 'paymentReference');

      const result = await idempotent(
        auth.tenantId, idem(req), `POST /emi-loans/${id}/payments`, await hash(b),
        async (c) => {
          const loan = await c.query('SELECT * FROM emi_loans WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [auth.tenantId, id]);
          if (!loan.rows[0]) throw Errors.notFound('EMI loan');
          const inst = await c.query(
            'SELECT * FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 AND installment_number=$3',
            [auth.tenantId, id, installmentNumber],
          );
          if (!inst.rows[0]) throw Errors.notFound('Installment');
          if (inst.rows[0].status === 'paid') throw Errors.conflict('Installment already paid');

          await c.query(
            `UPDATE emi_installments SET status='paid', amount_paid_paise=amount_due_paise, paid_at=now(),
              payment_mode=$3::payment_mode, payment_reference=$4, paid_by=$5
             WHERE tenant_id=$1 AND id=$2`,
            [auth.tenantId, inst.rows[0].id, paymentMode, paymentReference ?? 'DIRECT_TRANSFER', auth.userId],
          );
          await c.query(
            `INSERT INTO emi_payments (tenant_id,loan_id,installment_id,amount_paise,payment_date,payment_mode,payment_reference,recorded_by,idempotency_key)
             VALUES ($1,$2,$3,$4,CURRENT_DATE,$5::payment_mode,$6,$7,$8)`,
            [auth.tenantId, id, inst.rows[0].id, inst.rows[0].amount_due_paise, paymentMode, paymentReference ?? null, auth.userId, idem(req)],
          );
          const counts = await c.query(
            `SELECT count(*) FILTER (WHERE status='paid')::int AS paid,
                    (SELECT due_date FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 AND status<>'paid' ORDER BY installment_number LIMIT 1) AS next_date
             FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2`,
            [auth.tenantId, id],
          );
          const paid = counts.rows[0].paid;
          const updated = await c.query(
            `UPDATE emi_loans SET installments_paid=$3, next_emi_date=COALESCE($4::date,loan_end_date)
             WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, paid, counts.rows[0].next_date],
          );
          await writeAudit(c, auth, { action: 'EMI_PAID', entity: 'MachineEmiLoan', entityId: id, reason: `Installment #${installmentNumber} paid`, requestId: ctx.requestId });
          return { statusCode: 200, body: updated.rows[0] };
        },
      );
      return json(result.body, result.statusCode);
    },
  },
  {
    method: 'GET', path: '/emi/alerts',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'emi:read');
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT i.*, l.loan_code, l.loan_provider, l.reminder_lead_days, m.asset_code
           FROM emi_installments i JOIN emi_loans l ON l.id=i.loan_id JOIN machines m ON m.id=l.machine_id
           WHERE i.tenant_id=$1 AND i.status<>'paid' ORDER BY i.due_date`,
          [auth.tenantId],
        );
        const today = businessDate();
        return {
          items: r.rows.map((x: any) => {
            const ev = evaluateReminderStatus(x.due_date, x.reminder_lead_days, today);
            return { ...x, daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label };
          }).filter((x: any) => x.status !== 'none'),
        };
      });
      return json(result);
    },
  },
];
