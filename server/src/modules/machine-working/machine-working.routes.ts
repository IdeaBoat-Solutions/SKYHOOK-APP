import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { calculateWorkingAndOt } from '../../domain/calculations.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function machineWorkingRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(XLSX_MIME, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/machine-working-logs', { preHandler: requirePermission('machine:read') }, async (request) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional(), machineId: z.string().uuid().optional(), limit: z.coerce.number().int().max(1000).default(200) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT l.*, m.asset_code, p.name AS project_name FROM machine_working_logs l
         JOIN machines m ON m.id=l.machine_id JOIN projects p ON p.id=l.project_id
         WHERE l.tenant_id=$1 AND ($2::date IS NULL OR l.log_date >= $2::date) AND ($3::date IS NULL OR l.log_date <= $3::date)
           AND ($4::uuid IS NULL OR l.machine_id=$4) ORDER BY l.log_date DESC LIMIT $5`,
        [request.auth.tenantId, q.from ?? null, q.to ?? null, q.machineId ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.post('/machine-working-logs', { preHandler: requirePermission('machine:write') }, async (request, reply) => {
    const b = z.object({
      date: z.string(), machineId: z.string().uuid(), projectId: z.string().uuid(),
      operatorId: z.string().uuid().optional(), startTime: z.string(), endTime: z.string(),
      idleMinutes: z.number().int().nonnegative().default(0), remarks: z.string().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const calc = calculateWorkingAndOt(b.startTime, b.endTime, b.idleMinutes, 1440);
      const r = await c.query(
        `INSERT INTO machine_working_logs (tenant_id,log_date,machine_id,project_id,operator_id,start_time,end_time,
          idle_minutes,working_minutes,working_hours,remarks,approval_status,entered_by)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12) RETURNING *`,
        [request.auth.tenantId, b.date, b.machineId, b.projectId, b.operatorId ?? null, b.startTime, b.endTime,
          b.idleMinutes, calc.netWorkingMinutes, calc.netWorkingHours, b.remarks ?? null, request.auth.userId],
      );
      await writeAudit(c, request.auth, { action: 'MACHINE_HOURS_LOGGED', entity: 'MachineWorkingLog', entityId: r.rows[0].id, reason: `${calc.netWorkingHours}h`, requestId: request.id });
      return reply.code(201).send(r.rows[0]);
    });
  });

  app.get('/machine-working-logs/template', { preHandler: requirePermission('machine:write') }, async (_request, reply) => {
    const rows = [{
      'Date (YYYY-MM-DD)': '2026-10-24', 'Machine ID': 'CR-001', 'Project ID': 'PRJ-001',
      'Operator ID': '', 'Start Time (HH:mm)': '08:00', 'End Time (HH:mm)': '18:00',
      'Idle Minutes': 60, 'Remarks': 'Pier lifting operations',
    }];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'WorkingLogsTemplate');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return reply.header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', 'attachment; filename="Skyhook_Machine_Working_Import_Template.xlsx"')
      .send(buf);
  });

  app.post('/machine-working-logs/import', { preHandler: requirePermission('machine:write') }, async (request, reply) => {
    const raw = request.body as Buffer;
    if (!Buffer.isBuffer(raw)) throw Errors.badRequest('Expected XLSX file body');
    const wb = XLSX.read(raw, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

    return withTenant(request.auth.tenantId, async (c) => {
      const machines = await c.query('SELECT asset_code, id FROM machines WHERE tenant_id=$1', [request.auth.tenantId]);
      const projects = await c.query('SELECT project_code, id FROM projects WHERE tenant_id=$1', [request.auth.tenantId]);
      const employees = await c.query('SELECT employee_code, id FROM employees WHERE tenant_id=$1', [request.auth.tenantId]);
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
        [request.auth.tenantId, rows.length, valid.length, invalid.length, request.auth.userId],
      );
      for (const v of valid) {
        const calc = calculateWorkingAndOt(v.start, v.end, v.idle, 1440);
        await c.query(
          `INSERT INTO machine_working_logs (tenant_id,log_date,machine_id,project_id,operator_id,start_time,end_time,
            idle_minutes,working_minutes,working_hours,remarks,approval_status,entered_by,import_batch_id)
           VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12,$13)`,
          [request.auth.tenantId, v.date, v.machineId, v.projectId, v.operatorId, v.start, v.end, v.idle,
            calc.netWorkingMinutes, calc.netWorkingHours, v.remarks, request.auth.userId, batch.rows[0].id],
        );
      }
      await writeAudit(c, request.auth, { action: 'MACHINE_HOURS_EXCEL_IMPORTED', entity: 'ImportBatch', entityId: batch.rows[0].id, reason: `${valid.length} rows imported`, requestId: request.id });
      return reply.send({ totalRows: rows.length, validRows: valid.length, invalidRows: invalid.length, errors: invalid, batchId: batch.rows[0].id });
    });
  });
}
