import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { hasPermission, requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { businessDate } from '../../common/date.js';
import { evaluateReminderStatus } from '../../domain/calculations.js';

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reminders', { preHandler: requirePermission('company:read') }, async (request) => {
    const { category } = z.object({ category: z.string().optional() }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [request.auth.tenantId]);
      const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
      const today = businessDate();
      const items: any[] = [];

      if (!category || category !== 'emi') {
        const renewals = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL', [request.auth.tenantId]);
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
      if ((!category || category === 'emi') && hasPermission(request.auth, 'emi:read')) {
        const emi = await c.query(
          `SELECT i.due_date, i.installment_number, l.id, l.loan_code, l.reminder_lead_days, m.asset_code
           FROM emi_installments i JOIN emi_loans l ON l.id=i.loan_id JOIN machines m ON m.id=l.machine_id
           WHERE i.tenant_id=$1 AND i.status<>'paid'`,
          [request.auth.tenantId],
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
    });
  });

  app.get('/notifications', { preHandler: requirePermission('company:read') }, async (request) => {
    const q = z.object({ unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().max(200).default(100) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT * FROM notifications WHERE tenant_id=$1 AND ($2::boolean IS NULL OR is_read = NOT $2)
         ORDER BY created_at DESC LIMIT $3`,
        [request.auth.tenantId, q.unread ?? null, q.limit],
      );
      return { items: r.rows, unreadCount: r.rows.filter((n: any) => !n.is_read).length };
    });
  });

  app.patch('/notifications/:id', { preHandler: requirePermission('company:read') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = z.object({ read: z.boolean().optional(), status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional() }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE notifications SET is_read=COALESCE($3,is_read), read_at=CASE WHEN $3 THEN now() ELSE read_at END,
          status=COALESCE($4::text,status) WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [request.auth.tenantId, id, b.read ?? null, b.status ?? null],
      );
      if (!r.rows[0]) throw Errors.notFound('Notification');
      return r.rows[0];
    });
  });

  app.get('/notification-preferences', { preHandler: requirePermission('company:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT * FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [request.auth.tenantId, request.auth.userId]);
      return r.rows[0] ?? { email: true, sms: false, whatsapp: false };
    });
  });

  app.patch('/notification-preferences', { preHandler: requirePermission('company:read') }, async (request) => {
    const b = z.object({ email: z.boolean().optional(), sms: z.boolean().optional(), whatsapp: z.boolean().optional() }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const existing = await c.query('SELECT user_id FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [request.auth.tenantId, request.auth.userId]);
      if (!existing.rows[0]) {
        await c.query('INSERT INTO notification_preferences (tenant_id,user_id,email,sms,whatsapp) VALUES ($1,$2,$3,$4,$5)',
          [request.auth.tenantId, request.auth.userId, b.email ?? true, b.sms ?? false, b.whatsapp ?? false]);
      } else {
        await c.query('UPDATE notification_preferences SET email=COALESCE($3,email), sms=COALESCE($4,sms), whatsapp=COALESCE($5,whatsapp) WHERE tenant_id=$1 AND user_id=$2',
          [request.auth.tenantId, request.auth.userId, b.email ?? null, b.sms ?? null, b.whatsapp ?? null]);
      }
      const r = await c.query('SELECT * FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2', [request.auth.tenantId, request.auth.userId]);
      return r.rows[0];
    });
  });
}
