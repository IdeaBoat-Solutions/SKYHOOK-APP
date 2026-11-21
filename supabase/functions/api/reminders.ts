/** Reminders / notifications module ported from server/src/modules/reminders/reminders.routes.ts. */
import { config } from '../_shared/config.ts';
import { withTenant, withTenantRead } from '../_shared/db.ts';
import { hasPermission, requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { json, readJson } from '../_shared/http.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

function businessDate(): string {
  // Today in India (en-CA formats as yyyy-mm-dd). The old DEMO_DATE override is ignored so a
  // leftover secret can never pin reminders to a past date.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Ported from server/src/domain/calculations.ts (kept local — no Fastify/Node deps). */
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

/** Extract the dynamic tail of a path (e.g. the `:id` in /notifications/:id). */
function pathAfter(ctx: RouteCtx, _prefix: string): string {
  return ctx.params['*'] ?? ctx.params.id ?? '';
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw Errors.validation([{ field, message: 'Must be a string' }]);
  return v;
}

function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw Errors.validation([{ field, message: 'Must be a boolean' }]);
  return v;
}

function coerceBoolParam(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  return !(v === 'false' || v === '0' || v === '');
}

const NOTIFICATION_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
function optionalStatus(v: unknown): typeof NOTIFICATION_STATUSES[number] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !NOTIFICATION_STATUSES.includes(v as typeof NOTIFICATION_STATUSES[number])) {
    throw Errors.validation([{ field: 'status', message: 'Must be one of open, acknowledged, resolved, dismissed' }]);
  }
  return v as typeof NOTIFICATION_STATUSES[number];
}

export const remindersRoutes: Route[] = [
  {
    method: 'GET', path: '/reminders',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const category = optionalString(ctx.url.searchParams.get('category') ?? undefined, 'category');
      return json(await withTenantRead(auth.tenantId, async (c) => {
        const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [auth.tenantId]);
        const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
        const today = businessDate();
        const items: any[] = [];

        if (!category || category !== 'emi') {
          const renewals = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL', [auth.tenantId]);
          for (const r of renewals.rows as any[]) {
            if (category && r.category !== category) continue;
            const ev = evaluateReminderStatus(r.due_date, lead(r.category), today);
            if (ev.status !== 'none') {
              items.push({
                id: `${r.category}-${r.target_id}`, category: r.category, targetType: r.target_type,
                targetId: r.target_id, reference: r.reference, dueDate: r.due_date,
                daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label,
              });
            }
          }
        }
        if ((!category || category === 'emi') && hasPermission(auth, 'emi:read')) {
          const emi = await c.query(
            `SELECT i.due_date, i.installment_number, l.id, l.loan_code, l.reminder_lead_days, m.asset_code
             FROM emi_installments i JOIN emi_loans l ON l.id=i.loan_id JOIN machines m ON m.id=l.machine_id
             WHERE i.tenant_id=$1 AND i.status<>'paid'`,
            [auth.tenantId],
          );
          for (const r of emi.rows as any[]) {
            const ev = evaluateReminderStatus(r.due_date, lead('emi'), today);
            if (ev.status !== 'none') {
              items.push({
                id: `emi-${r.id}-${r.installment_number}`, category: 'emi', targetType: 'loan',
                targetId: r.id, reference: `${r.asset_code} / ${r.loan_code}`, dueDate: r.due_date,
                daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label,
              });
            }
          }
        }
        return { items: items.sort((a, b) => a.daysRemaining - b.daysRemaining), businessDate: today };
      }));
    },
  },
  {
    method: 'GET', path: '/notifications',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const unread = coerceBoolParam(ctx.url.searchParams.get('unread'));
      const rawLimit = ctx.url.searchParams.get('limit');
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 0 || limit > 200) {
        throw Errors.validation([{ field: 'limit', message: 'Must be an integer between 0 and 200' }]);
      }
      return json(await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT * FROM notifications WHERE tenant_id=$1 AND ($2::boolean IS NULL OR is_read = NOT $2)
           ORDER BY created_at DESC LIMIT $3`,
          [auth.tenantId, unread ?? null, limit],
        );
        return { items: r.rows, unreadCount: r.rows.filter((n: any) => !n.is_read).length };
      }));
    },
  },
  {
    method: 'PATCH', path: '/notifications/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const id = pathAfter(ctx, '/notifications');
      if (!id) throw Errors.badRequest('Notification id is required');
      const b = await readJson(req);
      const read = optionalBool(b.read, 'read');
      const status = optionalStatus(b.status);
      return json(await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE notifications SET is_read=COALESCE($3,is_read), read_at=CASE WHEN $3 THEN now() ELSE read_at END,
            status=COALESCE($4::text,status) WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [auth.tenantId, id, read ?? null, status ?? null],
        );
        if (!r.rows[0]) throw Errors.notFound('Notification');
        return r.rows[0];
      }));
    },
  },
  {
    method: 'GET', path: '/notification-preferences',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      return json(await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query('SELECT * FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [auth.tenantId, auth.userId]);
        return r.rows[0] ?? { email: true, sms: false, whatsapp: false };
      }));
    },
  },
  {
    method: 'PATCH', path: '/notification-preferences',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const b = await readJson(req);
      const email = optionalBool(b.email, 'email');
      const sms = optionalBool(b.sms, 'sms');
      const whatsapp = optionalBool(b.whatsapp, 'whatsapp');
      return json(await withTenant(auth.tenantId, async (c) => {
        const existing = await c.query('SELECT user_id FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [auth.tenantId, auth.userId]);
        if (!existing.rows[0]) {
          await c.query('INSERT INTO notification_preferences (tenant_id,user_id,email,sms,whatsapp) VALUES ($1,$2,$3,$4,$5)',
            [auth.tenantId, auth.userId, email ?? true, sms ?? false, whatsapp ?? false]);
        } else {
          await c.query('UPDATE notification_preferences SET email=COALESCE($3,email), sms=COALESCE($4,sms), whatsapp=COALESCE($5,whatsapp) WHERE tenant_id=$1 AND user_id=$2',
            [auth.tenantId, auth.userId, email ?? null, sms ?? null, whatsapp ?? null]);
        }
        const r = await c.query('SELECT * FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [auth.tenantId, auth.userId]);
        return r.rows[0];
      }));
    },
  },
];
