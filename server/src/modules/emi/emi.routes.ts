import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { idempotent } from '../../common/idempotency.js';
import { businessDate } from '../../common/date.js';
import { calculateEmi, evaluateReminderStatus } from '../../domain/calculations.js';

const loanSchema = z.object({
  assetId: z.string().uuid(),
  loanProvider: z.string().min(1),
  loanRefNumber: z.string().min(1),
  loanStartDate: z.string(),
  monthlyDueDay: z.number().int().min(1).max(28),
  principalPaise: z.number().int().positive(),
  annualInterestPct: z.number().nonnegative().default(0),
  tenureMonths: z.number().int().min(1).max(120),
  reminderLeadDays: z.number().int().min(0).default(15),
});

/** Unpaid instalments are overdue / due today relative to the business date, whatever the stored status says. */
function liveInstallments(rows: any[], today: string): any[] {
  return rows.map((i) => (i.status === 'paid' ? i : {
    ...i, status: i.due_date < today ? 'overdue' : i.due_date === today ? 'due_today' : 'upcoming',
  }));
}

function idem(request: any): string {
  return typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : randomUUID();
}
const hash = (b: unknown) => createHash('sha256').update(JSON.stringify(b ?? {})).digest('hex');

export async function emiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/emi/calculate', { preHandler: requirePermission('emi:read') }, async (request) => {
    const b = loanSchema.parse(request.body);
    const r = calculateEmi(b.principalPaise, b.annualInterestPct, b.tenureMonths, b.loanStartDate, b.monthlyDueDay);
    return {
      emiPaise: r.emiPaise, totalInterestPaise: r.totalInterestPaise,
      totalPayablePaise: r.totalPayablePaise, schedule: r.schedule.slice(0, 5),
    };
  });

  app.get('/emi-loans', { preHandler: requirePermission('emi:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT l.*, m.asset_code, (SELECT count(*)::int FROM emi_installments i WHERE i.loan_id=l.id AND i.status<>'paid') AS pending
         FROM emi_loans l JOIN machines m ON m.id=l.machine_id
         WHERE l.tenant_id=$1 ORDER BY l.loan_code`,
        [request.auth.tenantId],
      );
      // The EMI screen and reminders work from the schedule, so ship it with each loan.
      const inst = await c.query(
        'SELECT * FROM emi_installments WHERE tenant_id=$1 ORDER BY loan_id, installment_number',
        [request.auth.tenantId],
      );
      const byLoan = new Map<string, any[]>();
      for (const i of liveInstallments(inst.rows as any[], businessDate())) byLoan.set(i.loan_id, [...(byLoan.get(i.loan_id) ?? []), i]);
      return { items: r.rows.map((l: any) => ({ ...l, installments: byLoan.get(l.id) ?? [] })) };
    });
  });

  app.get('/emi-loans/:id', { preHandler: requirePermission('emi:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const loan = await c.query('SELECT * FROM emi_loans WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!loan.rows[0]) throw Errors.notFound('EMI loan');
      const inst = await c.query('SELECT * FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 ORDER BY installment_number', [request.auth.tenantId, id]);
      return { ...loan.rows[0], installments: liveInstallments(inst.rows as any[], businessDate()) };
    });
  });

  app.post('/emi-loans',{ preHandler: requirePermission('emi:write') }, async (request, reply) => {
    const b = loanSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const plan = calculateEmi(b.principalPaise, b.annualInterestPct, b.tenureMonths, b.loanStartDate, b.monthlyDueDay);
      const today = businessDate();
      const initialPaid = plan.schedule.filter((s) => s.dueDate < today).length;
      const nextDate = plan.schedule.find((s) => s.dueDate >= today)?.dueDate ?? plan.schedule[plan.schedule.length - 1]!.dueDate;
      const seq = await c.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(loan_code,'\\D','','g'),'')::bigint),0)::int AS n FROM emi_loans WHERE tenant_id=$1`,
        [request.auth.tenantId]);
      const code = `LOAN-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
      const loan = await c.query(
        `INSERT INTO emi_loans (tenant_id,loan_code,machine_id,loan_provider,loan_ref_number,loan_start_date,
          loan_end_date,emi_amount_paise,monthly_due_day,total_installments,installments_paid,next_emi_date,reminder_lead_days,created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12::date,$13,$14) RETURNING *`,
        [request.auth.tenantId, code, b.assetId, b.loanProvider, b.loanRefNumber, b.loanStartDate,
          plan.schedule[plan.schedule.length - 1]!.dueDate, plan.emiPaise, b.monthlyDueDay,
          b.tenureMonths, initialPaid, nextDate, b.reminderLeadDays, request.auth.userId],
      );
      for (const s of plan.schedule) {
        const status = s.dueDate < today ? 'paid' : s.dueDate === today ? 'due_today' : 'upcoming';
        await c.query(
          `INSERT INTO emi_installments (tenant_id,loan_id,installment_number,due_date,amount_due_paise,amount_paid_paise,status)
           VALUES ($1,$2,$3,$4::date,$5,$6,$7::emi_status)`,
          [request.auth.tenantId, loan.rows[0].id, s.number, s.dueDate, s.amountPaise, status === 'paid' ? s.amountPaise : 0, status],
        );
      }
      await writeAudit(c, request.auth, { action: 'EMI_LOAN_CREATED', entity: 'MachineEmiLoan', entityId: loan.rows[0].id, reason: `Loan ${code} for machine ${b.assetId}`, requestId: request.id });
      const saved = await c.query('SELECT * FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 ORDER BY installment_number', [request.auth.tenantId, loan.rows[0].id]);
      return reply.code(201).send({ ...loan.rows[0], installments: liveInstallments(saved.rows as any[], today) });
    });
  });

  app.post('/emi-loans/:id/payments', { preHandler: requirePermission('emi:write') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = z.object({
      installmentNumber: z.number().int().positive(),
      paymentMode: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'company_card']),
      paymentReference: z.string().optional(),
    }).parse(request.body);

    const result = await idempotent(
      request.auth.tenantId, idem(request), `POST /emi-loans/${id}/payments`, hash(request.body),
      async (c) => {
        const loan = await c.query('SELECT * FROM emi_loans WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [request.auth.tenantId, id]);
        if (!loan.rows[0]) throw Errors.notFound('EMI loan');
        const inst = await c.query(
          'SELECT * FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 AND installment_number=$3',
          [request.auth.tenantId, id, b.installmentNumber],
        );
        if (!inst.rows[0]) throw Errors.notFound('Installment');
        if (inst.rows[0].status === 'paid') throw Errors.conflict('Installment already paid');

        await c.query(
          `UPDATE emi_installments SET status='paid', amount_paid_paise=amount_due_paise, paid_at=now(),
            payment_mode=$3::payment_mode, payment_reference=$4, paid_by=$5
           WHERE tenant_id=$1 AND id=$2`,
          [request.auth.tenantId, inst.rows[0].id, b.paymentMode, b.paymentReference || null, request.auth.userId],
        );
        await c.query(
          `INSERT INTO emi_payments (tenant_id,loan_id,installment_id,amount_paise,payment_date,payment_mode,payment_reference,recorded_by,idempotency_key)
           VALUES ($1,$2,$3,$4,CURRENT_DATE,$5::payment_mode,$6,$7,$8)`,
          [request.auth.tenantId, id, inst.rows[0].id, inst.rows[0].amount_due_paise, b.paymentMode, b.paymentReference ?? null, request.auth.userId, idem(request)],
        );
        const counts = await c.query(
          `SELECT count(*) FILTER (WHERE status='paid')::int AS paid,
                  (SELECT due_date FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2 AND status<>'paid' ORDER BY installment_number LIMIT 1) AS next_date
           FROM emi_installments WHERE tenant_id=$1 AND loan_id=$2`,
          [request.auth.tenantId, id],
        );
        const paid = counts.rows[0].paid;
        const updated = await c.query(
          `UPDATE emi_loans SET installments_paid=$3, next_emi_date=COALESCE($4::date,loan_end_date)
           WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [request.auth.tenantId, id, paid, counts.rows[0].next_date],
        );
        await writeAudit(c, request.auth, { action: 'EMI_PAID', entity: 'MachineEmiLoan', entityId: id, reason: `Installment #${b.installmentNumber} paid`, requestId: request.id });
        return { statusCode: 200, body: updated.rows[0] };
      },
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.get('/emi/alerts', { preHandler: requirePermission('emi:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT i.*, l.loan_code, l.loan_provider, l.reminder_lead_days, m.asset_code
         FROM emi_installments i JOIN emi_loans l ON l.id=i.loan_id JOIN machines m ON m.id=l.machine_id
         WHERE i.tenant_id=$1 AND i.status<>'paid' ORDER BY i.due_date`,
        [request.auth.tenantId],
      );
      const today = businessDate();
      return {
        items: r.rows.map((x: any) => {
          const ev = evaluateReminderStatus(x.due_date, x.reminder_lead_days, today);
          return { ...x, daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label };
        }).filter((x: any) => x.status !== 'none'),
      };
    });
  });
}
