/** Machine working module ported from server/src/modules/machine-working/machine-working.routes.ts. */
import * as XLSX from 'npm:xlsx@0.18.5';
import { query, withTenant, withTenantRead, pool } from '../_shared/db.ts';
import { corsHeaders, json, readJson } from '../_shared/http.ts';
import { Errors } from '../_shared/errors.ts';
import { requirePermission } from '../_shared/rbac.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type { Queryable } from '../_shared/db.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------------------------ *
 * Local validators (replacement for the zod schemas in the source)
 * ------------------------------------------------------------------ */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    throw Errors.validation([{ field, message: 'Must be a valid UUID' }]);
  }
  return v;
}

function optionalUuid(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return uuid(v, field);
}

function requiredStr(v: unknown, field: string, min = 1): string {
  if (typeof v !== 'string' || v.length < min) {
    throw Errors.validation([{ field, message: `Must be a string of at least ${min} characters` }]);
  }
  return v;
}

function optionalStr(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw Errors.validation([{ field, message: 'Must be a string' }]);
  return v;
}

function intNonnegative(v: unknown, field: string, defaultValue?: number): number {
  if (v === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be a non-negative integer' }]);
  }
  return v;
}

function queryInt(raw: string | null, field: string, defaultValue: number, max: number): number {
  if (raw === null) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n > max) {
    throw Errors.validation([{ field, message: `Must be an integer no greater than ${max}` }]);
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/domain/calculations.ts
 * ------------------------------------------------------------------ */
interface TimeDurationResult {
  totalSpanMinutes: number;
  netWorkingMinutes: number;
  netWorkingHours: number;
  potentialOtMinutes: number;
  potentialOtHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const str = time.includes('T') ? (time.split('T')[1] ?? '') : time;
  const [h = '0', m = '0'] = str.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

function calculateWorkingAndOt(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0,
  standardShiftMinutes = 600,
): TimeDurationResult {
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end < start) end += 1440; // overnight shift
  const totalSpanMinutes = Math.max(0, end - start);
  const netWorkingMinutes = Math.max(0, totalSpanMinutes - Math.max(0, unpaidBreakMinutes));
  const netWorkingHours = round2(netWorkingMinutes / 60);
  const potentialOtMinutes = Math.max(0, netWorkingMinutes - standardShiftMinutes);
  return {
    totalSpanMinutes,
    netWorkingMinutes,
    netWorkingHours,
    potentialOtMinutes,
    potentialOtHours: round2(potentialOtMinutes / 60),
  };
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/common/audit.ts
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

/** Read the uploaded workbook from a multipart form, or from a raw XLSX body. */
async function readWorkbookBytes(req: Request): Promise<Uint8Array> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    let file = form.get('file');
    if (!(file instanceof File)) file = form.get('upload');
    if (!(file instanceof File)) {
      for (const value of form.values()) {
        if (value instanceof File) { file = value; break; }
      }
    }
    if (!(file instanceof File)) throw Errors.badRequest('Expected XLSX file body');
    return new Uint8Array(await file.arrayBuffer());
  }
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw Errors.badRequest('Expected XLSX file body');
  return new Uint8Array(buf);
}

export const machineWorkingRoutes: Route[] = [
  {
    method: 'GET', path: '/machine-working-logs',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const from = ctx.url.searchParams.get('from');
      const to = ctx.url.searchParams.get('to');
      const machineIdParam = ctx.url.searchParams.get('machineId');
      const machineId = machineIdParam === null ? undefined : optionalUuid(machineIdParam, 'machineId');
      const limit = queryInt(ctx.url.searchParams.get('limit'), 'limit', 200, 1000);
      const result = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT l.*, m.asset_code, p.name AS project_name FROM machine_working_logs l
         JOIN machines m ON m.id=l.machine_id JOIN projects p ON p.id=l.project_id
         WHERE l.tenant_id=$1 AND ($2::date IS NULL OR l.log_date >= $2::date) AND ($3::date IS NULL OR l.log_date <= $3::date)
           AND ($4::uuid IS NULL OR l.machine_id=$4) ORDER BY l.log_date DESC LIMIT $5`,
        [auth.tenantId, from, to, machineId ?? null, limit],
      ));
      return json({ items: result.rows, total: result.rowCount });
    },
  },
  {
    method: 'POST', path: '/machine-working-logs',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const b = await readJson(req);
      const body = {
        date: requiredStr(b.date, 'date'),
        machineId: uuid(b.machineId, 'machineId'),
        projectId: uuid(b.projectId, 'projectId'),
        operatorId: optionalUuid(b.operatorId, 'operatorId'),
        startTime: requiredStr(b.startTime, 'startTime'),
        endTime: requiredStr(b.endTime, 'endTime'),
        idleMinutes: intNonnegative(b.idleMinutes, 'idleMinutes', 0),
        remarks: optionalStr(b.remarks, 'remarks'),
      };
      const row = await withTenant(auth.tenantId, async (c) => {
        const calc = calculateWorkingAndOt(body.startTime, body.endTime, body.idleMinutes, 1440);
        const r = await c.query(
          `INSERT INTO machine_working_logs (tenant_id,log_date,machine_id,project_id,operator_id,start_time,end_time,
           idle_minutes,working_minutes,working_hours,remarks,approval_status,entered_by)
          VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12) RETURNING *`,
          [auth.tenantId, body.date, body.machineId, body.projectId, body.operatorId ?? null, body.startTime, body.endTime,
            body.idleMinutes, calc.netWorkingMinutes, calc.netWorkingHours, body.remarks ?? null, auth.userId],
        );
        await writeAudit(c, auth, {
          action: 'MACHINE_HOURS_LOGGED', entity: 'MachineWorkingLog', entityId: r.rows[0].id,
          reason: `${calc.netWorkingHours}h`, requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(row, 201);
    },
  },
  {
    method: 'GET', path: '/machine-working-logs/template',
    handler: async (ctx) => {
      requirePermission(ctx.auth!, 'machine:write');
      const rows = [{
        'Date (YYYY-MM-DD)': '2026-10-24', 'Machine ID': 'CR-001', 'Project ID': 'PRJ-001',
        'Operator ID': '', 'Start Time (HH:mm)': '08:00', 'End Time (HH:mm)': '18:00',
        'Idle Minutes': 60, 'Remarks': 'Pier lifting operations',
      }];
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'WorkingLogsTemplate');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': XLSX_MIME,
          'Content-Disposition': 'attachment; filename="Skyhook_Machine_Working_Import_Template.xlsx"',
          ...corsHeaders(),
        },
      });
    },
  },
  {
    method: 'POST', path: '/machine-working-logs/import',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const bytes = await readWorkbookBytes(req);
      const wb = XLSX.read(bytes, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Array<Record<string, any>>;

      const result = await withTenant(auth.tenantId, async (c) => {
        const machines = await c.query('SELECT asset_code, id FROM machines WHERE tenant_id=$1', [auth.tenantId]);
        const projects = await c.query('SELECT project_code, id FROM projects WHERE tenant_id=$1', [auth.tenantId]);
        const employees = await c.query('SELECT employee_code, id FROM employees WHERE tenant_id=$1', [auth.tenantId]);
        const machineMap = new Map(machines.rows.map((m: any) => [m.asset_code, m.id]));
        const projectMap = new Map(projects.rows.map((p: any) => [p.project_code, p.id]));
        const employeeMap = new Map(employees.rows.map((e: any) => [e.employee_code, e.id]));

        const valid: any[] = [];
        const invalid: any[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          const errors: string[] = [];
          const date = String(row['Date (YYYY-MM-DD)'] ?? row['Date'] ?? '').trim();
          const mCode = String(row['Machine ID'] ?? '').trim().toUpperCase();
          const pCode = String(row['Project ID'] ?? '').trim().toUpperCase();
          const eCode = String(row['Operator ID'] ?? '').trim().toUpperCase();
          const start = String(row['Start Time (HH:mm)'] ?? row['Start Time'] ?? '').trim();
          const end = String(row['End Time (HH:mm)'] ?? row['End Time'] ?? '').trim();
          const idle = Number(row['Idle Minutes'] ?? 0) || 0;

          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Invalid date');
          if (!machineMap.has(mCode)) errors.push(`Unknown machine ${mCode}`);
          if (!projectMap.has(pCode)) errors.push(`Unknown project ${pCode}`);
          if (eCode && !employeeMap.has(eCode)) errors.push(`Unknown operator ${eCode}`);
          if (!/^\d{1,2}:\d{2}$/.test(start)) errors.push('Invalid start time');
          if (!/^\d{1,2}:\d{2}$/.test(end)) errors.push('Invalid end time');
          if (idle < 0) errors.push('Negative idle');

          if (errors.length) invalid.push({ row: i + 2, errors, data: row });
          else valid.push({ date, machineId: machineMap.get(mCode)!, projectId: projectMap.get(pCode)!, operatorId: eCode ? employeeMap.get(eCode)! : null, start, end, idle, remarks: String(row['Remarks'] ?? '') });
        }

        const batch = await c.query(
          `INSERT INTO import_batches (tenant_id,kind,file_key,total_rows,valid_rows,rejected_rows,status,created_by)
           VALUES ($1,'machine_working','upload', $2,$3,$4,'committed',$5) RETURNING id`,
          [auth.tenantId, rows.length, valid.length, invalid.length, auth.userId],
        );
        for (const v of valid) {
          const calc = calculateWorkingAndOt(v.start, v.end, v.idle, 1440);
          await c.query(
            `INSERT INTO machine_working_logs (tenant_id,log_date,machine_id,project_id,operator_id,start_time,end_time,
             idle_minutes,working_minutes,working_hours,remarks,approval_status,entered_by,import_batch_id)
            VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12,$13)`,
            [auth.tenantId, v.date, v.machineId, v.projectId, v.operatorId, v.start, v.end, v.idle,
              calc.netWorkingMinutes, calc.netWorkingHours, v.remarks, auth.userId, batch.rows[0].id],
          );
        }
        await writeAudit(c, auth, {
          action: 'MACHINE_HOURS_EXCEL_IMPORTED', entity: 'ImportBatch', entityId: batch.rows[0].id,
          reason: `${valid.length} rows imported`, requestId: ctx.requestId,
        });
        return { totalRows: rows.length, validRows: valid.length, invalidRows: invalid.length, errors: invalid, batchId: batch.rows[0].id };
      });
      return json(result);
    },
  },
];
