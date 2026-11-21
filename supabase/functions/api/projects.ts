/** Projects module ported from server/src/modules/projects/projects.routes.ts. */
import { query, withTenant, withTenantRead, pool } from '../_shared/db.ts';
import { json, readJson } from '../_shared/http.ts';
import { Errors } from '../_shared/errors.ts';
import { requirePermission } from '../_shared/rbac.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type { Queryable } from '../_shared/db.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

/* ------------------------------------------------------------------ *
 * Local validators (replacement for the zod schemas in the source)
 * ------------------------------------------------------------------ */
function requiredStr(v: unknown, field: string, min = 1): string {
  if (typeof v !== 'string' || v.length < min) {
    throw Errors.validation([{ field, message: `Must be a string of at least ${min} characters` }]);
  }
  return v;
}

function optionalStr(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw Errors.validation([{ field, message: 'Must be a string' }]);
  }
  return v;
}

function intNonnegative(v: unknown, field: string, defaultValue?: number): number {
  if (v === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be a non-negative integer' }]);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, field: string, values: readonly T[], defaultValue?: T): T {
  if (v === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof v !== 'string' || !values.includes(v as T)) {
    throw Errors.validation([{ field, message: `Must be one of: ${values.join(', ')}` }]);
  }
  return v as T;
}

function queryInt(raw: string | null, field: string, defaultValue: number, max: number): number {
  if (raw === null) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n > max) {
    throw Errors.validation([{ field, message: `Must be an integer no greater than ${max}` }]);
  }
  return n;
}

/** Extract a Fastify-style :id parameter from the real request path. */
function pathParam(ctx: RouteCtx, fromEnd = 0): string {
  const segs = ctx.url.pathname.split('/').filter(Boolean);
  return segs[segs.length - 1 - fromEnd] ?? '';
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/common/audit.ts (needed by the handlers)
 * ------------------------------------------------------------------ */
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

const PROJECT_STATUSES = ['upcoming', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export const projectsRoutes: Route[] = [
  {
    method: 'GET', path: '/projects',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'project:read');
      const status = ctx.url.searchParams.get('status');
      const limit = queryInt(ctx.url.searchParams.get('limit'), 'limit', 200, 500);
      const result = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT * FROM projects WHERE tenant_id=$1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR status::text=$2) ORDER BY project_code LIMIT $3`,
        [auth.tenantId, status, limit],
      ));
      return json({ items: result.rows, total: result.rowCount });
    },
  },
  {
    method: 'GET', path: '/projects/:id',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'project:read');
      const id = pathParam(ctx);
      const result = await withTenantRead(auth.tenantId, (c) => c.query(
        'SELECT * FROM projects WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id],
      ));
      if (!result.rows[0]) throw Errors.notFound('Project');
      return json(result.rows[0]);
    },
  },
  {
    method: 'POST', path: '/projects',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'project:write');
      const b = await readJson(req);
      const body = {
        name: requiredStr(b.name, 'name'),
        clientName: requiredStr(b.clientName, 'clientName'),
        clientPhone: requiredStr(b.clientPhone, 'clientPhone'),
        clientEmail: optionalStr(b.clientEmail ?? undefined, 'clientEmail') || undefined,
        location: optionalStr(b.location ?? undefined, 'location'),
        siteAddress: optionalStr(b.siteAddress ?? undefined, 'siteAddress'),
        city: optionalStr(b.city ?? undefined, 'city'),
        state: optionalStr(b.state ?? undefined, 'state'),
        startDate: requiredStr(b.startDate, 'startDate'),
        expectedEndDate: requiredStr(b.expectedEndDate, 'expectedEndDate'),
        otRatePaisePerHour: intNonnegative(b.otRatePaisePerHour, 'otRatePaisePerHour', 0),
        contractValuePaise: b.contractValuePaise === undefined || b.contractValuePaise === null
          ? undefined : intNonnegative(b.contractValuePaise, 'contractValuePaise'),
        description: optionalStr(b.description ?? undefined, 'description'),
        status: oneOf(b.status, 'status', PROJECT_STATUSES, 'upcoming'),
      };
      const row = await withTenant(auth.tenantId, async (c) => {
        // Highest existing number + 1 (a plain count collides once any code is skipped).
        const seq = await c.query(
          `SELECT COALESCE(MAX(NULLIF(regexp_replace(project_code,'\\D','','g'),'')::bigint),0)::int AS n FROM projects WHERE tenant_id=$1`,
          [auth.tenantId]);
        const code = `PRJ-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO projects (tenant_id,project_code,name,client_name,client_phone,client_email,
           location,site_address,city,state,start_date,expected_end_date,ot_rate_paise_per_hour,
           contract_value_paise,description,status,manager_id,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13,$14,$15,$16,$17,$17)
          RETURNING *`,
          [
            auth.tenantId, code, body.name, body.clientName, body.clientPhone, body.clientEmail ?? null,
            body.location ?? null, body.siteAddress ?? null, body.city ?? null, body.state ?? null,
            body.startDate, body.expectedEndDate, body.otRatePaisePerHour, body.contractValuePaise ?? null,
            body.description ?? null, body.status, auth.userId,
          ],
        );
        await writeAudit(c, auth, {
          action: 'PROJECT_CREATED', entity: 'Project', entityId: r.rows[0].id,
          reason: `Created project: ${body.name}`, requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(row, 201);
    },
  },
  {
    method: 'PATCH', path: '/projects/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'project:write');
      const id = pathParam(ctx);
      const b = await readJson(req);
      /** Optional text: '' or null clears it. */
      const clearText = (f: string): string | null | undefined => {
        const v = b[f];
        if (v === undefined) return undefined;
        if (v === null || v === '') return null;
        return requiredStr(v, f);
      };
      const isoDate = (f: string, clearable: boolean): string | null | undefined => {
        const v = b[f];
        if (v === undefined) return undefined;
        if (clearable && (v === null || v === '')) return null;
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          throw Errors.validation([{ field: f, message: 'Must be a date (yyyy-mm-dd)' }]);
        }
        return v;
      };
      const parsed: Record<string, string | number | null | undefined> = {
        name: b.name === undefined ? undefined : requiredStr(b.name, 'name'),
        status: b.status === undefined ? undefined : oneOf(b.status, 'status', PROJECT_STATUSES),
        clientName: b.clientName === undefined ? undefined : requiredStr(b.clientName, 'clientName'),
        clientPhone: b.clientPhone === undefined ? undefined : requiredStr(b.clientPhone, 'clientPhone'),
        clientEmail: clearText('clientEmail'), location: clearText('location'), siteAddress: clearText('siteAddress'),
        city: clearText('city'), state: clearText('state'),
        startDate: isoDate('startDate', false), expectedEndDate: isoDate('expectedEndDate', false),
        actualEndDate: isoDate('actualEndDate', true),
        otRatePaisePerHour: b.otRatePaisePerHour === undefined ? undefined : intNonnegative(b.otRatePaisePerHour, 'otRatePaisePerHour'),
        contractValuePaise: b.contractValuePaise === undefined ? undefined
          : b.contractValuePaise === null ? null : intNonnegative(b.contractValuePaise, 'contractValuePaise'),
        description: clearText('description'),
      };
      const row = await withTenant(auth.tenantId, async (c) => {
        const before = await c.query('SELECT * FROM projects WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!before.rows[0]) throw Errors.notFound('Project');
        const map: Record<string, [string, string?]> = {
          name: ['name'], status: ['status', '::project_status'], clientName: ['client_name'], clientPhone: ['client_phone'],
          clientEmail: ['client_email'], location: ['location'], siteAddress: ['site_address'], city: ['city'], state: ['state'],
          startDate: ['start_date', '::date'], expectedEndDate: ['expected_end_date', '::date'], actualEndDate: ['actual_end_date', '::date'],
          otRatePaisePerHour: ['ot_rate_paise_per_hour'], contractValuePaise: ['contract_value_paise'], description: ['description'],
        };
        const entries = Object.entries(parsed).filter(([, v]) => v !== undefined);
        if (!entries.length) throw Errors.badRequest('No fields to update');
        // $1 tenant, $2 user, $3 project id; values occupy $4..$n.
        const sets = entries.map(([k], i) => `${map[k]![0]} = $${i + 4}${map[k]![1] ?? ''}`).join(', ');
        const r = await c.query(
          `UPDATE projects SET ${sets}, updated_by=$2, updated_at=now() WHERE tenant_id=$1 AND id=$3 RETURNING *`,
          [auth.tenantId, auth.userId, id, ...entries.map(([, v]) => v)],
        );
        await writeAudit(c, auth, {
          action: 'PROJECT_UPDATED', entity: 'Project', entityId: id,
          previousValue: before.rows[0], updatedValue: r.rows[0], requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(row);
    },
  },
];
