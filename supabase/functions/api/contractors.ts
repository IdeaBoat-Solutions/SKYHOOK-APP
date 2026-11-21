/** External / freelancer contractor and operator directory (contact records, not employees). */
import { withTenant, withTenantRead } from '../_shared/db.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { corsHeaders, json, readJson } from '../_shared/http.ts';
import type { Route } from '../_shared/types.ts';

const COLUMNS = `id, contractor_code, full_name, mobile, skill, agency_name,
  daily_rate_paise, city, availability, notes, created_at, updated_at`;

const SKILLS = ['crane_operator', 'rigger', 'bankman', 'electrician', 'fitter', 'driver', 'other'];
const AVAILABILITY = ['available', 'busy', 'unknown'];

function toContractor(r: any) {
  return {
    id: r.id,
    contractorCode: r.contractor_code,
    fullName: r.full_name,
    mobile: r.mobile,
    skill: r.skill,
    agencyName: r.agency_name ?? undefined,
    dailyRatePaise: r.daily_rate_paise,
    city: r.city ?? undefined,
    availability: r.availability,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

function strField(b: any, field: string, min = 1, max = 500): string {
  const v = b?.[field];
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function optionalStr(b: any, field: string, max = 2000): string | null {
  const v = b?.[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of at most ${max} characters` }]);
  }
  return v.trim() || null;
}

function paiseField(b: any, field: string, required = false): number | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (required) throw Errors.validation([{ field, message: 'Required' }]);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be an integer >= 0' }]);
  }
  return v;
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export const contractorRoutes: Route[] = [
  {
    method: 'GET', path: '/contractors',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:read');
      const skill = ctx.url.searchParams.get('skill');
      const availability = ctx.url.searchParams.get('availability');
      const search = ctx.url.searchParams.get('search');
      if (skill && !SKILLS.includes(skill)) throw Errors.validation([{ field: 'skill', message: 'Invalid skill' }]);
      if (availability && !AVAILABILITY.includes(availability)) {
        throw Errors.validation([{ field: 'availability', message: 'Invalid availability' }]);
      }
      const items = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT ${COLUMNS} FROM contractors
           WHERE tenant_id=$1
             AND ($2::text IS NULL OR skill::text=$2)
             AND ($3::text IS NULL OR availability::text=$3)
             AND ($4::text IS NULL OR full_name ILIKE '%'||$4||'%' OR mobile ILIKE '%'||$4||'%' OR agency_name ILIKE '%'||$4||'%')
           ORDER BY contractor_code LIMIT 500`,
          [auth.tenantId, skill, availability, search],
        );
        return r.rows.map(toContractor);
      });
      return json({ items });
    },
  },
  {
    method: 'POST', path: '/contractors',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const b = await readJson(req);
      const skill = b?.skill ?? 'crane_operator';
      const availability = b?.availability ?? 'available';
      if (!SKILLS.includes(skill)) throw Errors.validation([{ field: 'skill', message: 'Invalid skill' }]);
      if (!AVAILABILITY.includes(availability)) {
        throw Errors.validation([{ field: 'availability', message: 'Invalid availability' }]);
      }
      const fullName = strField(b, 'fullName', 1, 160);
      const mobile = strField(b, 'mobile', 1, 32);
      const item = await withTenant(auth.tenantId, async (c) => {
        const seq = await c.query(
          'SELECT COALESCE(MAX(CAST(SUBSTRING(contractor_code FROM 4) AS INTEGER)),0)+1 AS next FROM contractors WHERE tenant_id=$1',
          [auth.tenantId],
        );
        const code = `EXT-${String(seq.rows[0].next).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO contractors (id, tenant_id, contractor_code, full_name, mobile, skill,
             agency_name, daily_rate_paise, city, availability, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING ${COLUMNS}`,
          [crypto.randomUUID(), auth.tenantId, code, fullName, mobile, skill,
            optionalStr(b, 'agencyName', 160), paiseField(b, 'dailyRatePaise') ?? 0,
            optionalStr(b, 'city', 120), availability, optionalStr(b, 'notes'), auth.userId],
        );
        return toContractor(r.rows[0]);
      });
      return json(item, 201);
    },
  },
  {
    method: 'PATCH', path: '/contractors/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const raw = await readJson(req);
      const map: Record<string, string> = {
        fullName: 'full_name', mobile: 'mobile', skill: 'skill', agencyName: 'agency_name',
        dailyRatePaise: 'daily_rate_paise', city: 'city', availability: 'availability', notes: 'notes',
      };
      const entries: Array<[string, unknown]> = [];
      for (const field of Object.keys(map)) {
        const v = raw?.[field];
        if (v === undefined) continue;
        if (field === 'dailyRatePaise') entries.push([map[field]!, paiseField(raw, field, true)!]);
        else if (field === 'agencyName' || field === 'city') entries.push([map[field]!, optionalStr(raw, field, field === 'city' ? 120 : 160)]);
        else if (field === 'notes') entries.push([map[field]!, optionalStr(raw, field)]);
        else if (field === 'skill' && !SKILLS.includes(v)) throw Errors.validation([{ field, message: 'Invalid skill' }]);
        else if (field === 'availability' && !AVAILABILITY.includes(v)) {
          throw Errors.validation([{ field, message: 'Invalid availability' }]);
        } else entries.push([map[field]!, strField(raw, field)]);
      }
      if (!entries.length) throw Errors.validation([{ field: '(root)', message: 'No fields to update' }]);
      const sets = entries.map(([col], i) => `${col}=$${i + 3}`).join(', ');
      const item = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE contractors SET ${sets}, updated_at=now()
           WHERE tenant_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
          [auth.tenantId, ctx.params.id, ...entries.map(([, v]) => v)],
        );
        if (!r.rows[0]) throw Errors.notFound('Contractor');
        return toContractor(r.rows[0]);
      });
      return json(item);
    },
  },
  {
    method: 'DELETE', path: '/contractors/:id',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      await withTenant(auth.tenantId, async (c) => {
        const r = await c.query('DELETE FROM contractors WHERE tenant_id=$1 AND id=$2', [auth.tenantId, ctx.params.id]);
        if (r.rowCount === 0) throw Errors.notFound('Contractor');
      });
      return noContent();
    },
  },
];
