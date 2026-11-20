import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { hashPassword } from '../auth/password.js';
import { ALL_PERMISSIONS, MANAGER_PERMISSIONS } from '../auth/rbac.js';
import { supabaseMode } from '../config.js';
import { provisionAuthUser, type SkyhookClaims } from '../auth/supabase.js';

const INR = (n: number) => n * 100;
const DEMO_DATE = '2026-10-24';

export async function seed(): Promise<void> {
  // tenants has no tenant_id column, so RLS does not apply.
  const tenant = await pool.query(
    `INSERT INTO tenants (name, slug, demo_date) VALUES ('Skyhook','skyhook',$1::date)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [DEMO_DATE],
  );
  const tenantId = tenant.rows[0].id as string;

  await withTenant(tenantId, async (c) => {
    // permissions
    for (const code of ALL_PERMISSIONS) {
      await c.query('INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
    }

    // roles
    await c.query(`INSERT INTO roles (tenant_id,name,label) VALUES
      ($1,'owner','Owner / Super Admin'),($1,'manager','Site Manager')
      ON CONFLICT (tenant_id,name) DO NOTHING`, [tenantId]);
    const roles = await c.query('SELECT id,name FROM roles WHERE tenant_id=$1', [tenantId]);
    const roleId = (name: string) => roles.rows.find((r: any) => r.name === name).id as string;

    await c.query(`INSERT INTO role_permissions (role_id,permission_id)
      SELECT $1, id FROM permissions ON CONFLICT DO NOTHING`, [roleId('owner')]);
    await c.query(`INSERT INTO role_permissions (role_id,permission_id)
      SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`,
      [roleId('manager'), [...MANAGER_PERMISSIONS]]);

    // users — passwords live in Supabase Auth when configured, else in credentials.
    const users: [name: string, email: string, role: string, password: string][] = [
      ['Skyhook Admin', 'admin@skyhook.com', 'owner', 'skyhook@2026'],
      ['Skyhook Manager', 'manager@skyhook.com', 'manager', 'skyhook@2026'],
      ['Vikram Singhania', 'owner@skyhook.in', 'owner', 'skyhook2026'],
      ['Rajesh Sharma', 'manager@skyhook.in', 'manager', 'skyhook2026'],
      ['Amit Verma', 'amit@skyhook.in', 'manager', 'skyhook2026'],
    ];
    for (const [name, email, role, password] of users) {
      const passwordHash = supabaseMode ? null : await hashPassword(password);
      const existing = await c.query(
        'SELECT id, auth_user_id FROM users WHERE tenant_id=$1 AND email=$2',
        [tenantId, email],
      );
      const userId = (existing.rows[0]?.id as string | undefined) ?? randomUUID();
      let authUserId = (existing.rows[0]?.auth_user_id as string | null | undefined) ?? null;

      if (supabaseMode) {
        const claims: SkyhookClaims = {
          tenantId,
          skyhookUserId: userId,
          email,
          name: name!,
          roles: [role!],
          permissions: role === 'owner' ? [...ALL_PERMISSIONS] : [...MANAGER_PERMISSIONS],
        };
        authUserId = await provisionAuthUser({
          ...claims,
          password,
          authUserId,
        });
      }

      await c.query(
        `INSERT INTO users (id,tenant_id,email,name,auth_user_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id,email) DO UPDATE SET name=EXCLUDED.name,
           auth_user_id=COALESCE(EXCLUDED.auth_user_id, users.auth_user_id)`,
        [userId, tenantId, email, name, authUserId],
      );
      if (passwordHash) {
        await c.query(
          `INSERT INTO credentials (user_id,password_hash) VALUES ($1,$2)
           ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
          [userId, passwordHash],
        );
      }
      await c.query(
        `INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tenantId, userId, roleId(role!)],
      );
    }

    // company settings
    await c.query(
      `INSERT INTO company_settings (tenant_id,name,tagline,gst_number,authorized_signatory,
        signatory_title,standard_shift_minutes,payroll_payment_day)
       VALUES ($1,'SKYHOOK','Elevating Crane Operations.','27AABCS1429K1ZM','Vikram Singhania',
        'Managing Director',600,15)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );

    // projects
    await c.query(
      `INSERT INTO projects (tenant_id,project_code,name,client_name,client_phone,location,
        start_date,expected_end_date,ot_rate_paise_per_hour,contract_value_paise,status)
       VALUES ($1,'PRJ-001','Metro Rail Line 4 Viaduct','MMRDA','022-12345678','Mumbai',
        '2026-09-01','2027-03-31',$2,$3,'active'),
       ($1,'PRJ-002','Coastal Road Flyover','MSRDC','022-87654321','Mumbai',
        '2026-08-15','2027-01-31',$4,$5,'active')
       ON CONFLICT (tenant_id,project_code) DO NOTHING`,
      [tenantId, INR(150), INR(4_85_00_000), INR(200), INR(3_60_00_000)],
    );

    // employees
    await c.query(
      `INSERT INTO employees (tenant_id,employee_code,full_name,mobile,joining_date,designation,
        employee_type,salary_type,daily_rate_paise,monthly_salary_paise,salary_effective_date,
        license_number,crane_license_expiry)
       VALUES ($1,'OP-001','Ramesh Patel','9876543210','2024-01-15','Crane Operator','operator','daily',$2,0,'2024-01-15','MH04-CRN-112233','2026-12-15'),
       ($1,'OP-002','Suresh Yadav','9876543211','2024-03-02','Crane Operator','operator','daily',$3,0,'2024-03-02','MH04-CRN-445566','2026-10-22'),
       ($1,'EMP-101','Priya Kulkarni','9876543212','2023-06-01','Accounts & HR','accounts','monthly',0,$4,'2023-06-01',NULL,NULL)
       ON CONFLICT (tenant_id,employee_code) DO NOTHING`,
      [tenantId, INR(900), INR(950), INR(45000)],
    );

    // machines
    await c.query(
      `INSERT INTO machines (tenant_id,asset_code,machine_type,make,model,registration_number,
        next_service_due_date,insurance_expiry_date,puc_expiry_date,next_fitness_due_date,status)
       VALUES ($1,'CR-001','mobile_crane','Liebherr','LTM 1100-4.2','MH-12-AB-1234',
        '2026-10-20','2026-10-23','2026-10-24','2026-10-28','assigned'),
       ($1,'CR-002','mobile_crane','Kato','CR-250','MH-12-CD-5678',
        '2026-11-15','2026-12-10','2026-11-30','2026-12-01','available')
       ON CONFLICT (tenant_id,asset_code) DO NOTHING`,
      [tenantId],
    );

    // advance
    await c.query(
      `INSERT INTO salary_advances (tenant_id,advance_code,employee_id,advance_date,amount_paise,
        payment_mode,recovery_paise,outstanding_paise,status)
       SELECT $1,'ADV-001',id,'2026-10-05',$2,'bank_transfer',$3,$4,'partially_recovered'
       FROM employees WHERE tenant_id=$1 AND employee_code='OP-001'
       ON CONFLICT (tenant_id,advance_code) DO NOTHING`,
      [tenantId, INR(5000), INR(2500), INR(2500)],
    );

    // attendance for Ramesh: 24 working days + OT on 7th (4h @150) and 14th (6h @200)
    const emps = await c.query('SELECT id,employee_code FROM employees WHERE tenant_id=$1', [tenantId]);
    const prjs = await c.query('SELECT id,project_code,ot_rate_paise_per_hour FROM projects WHERE tenant_id=$1', [tenantId]);
    const rid = emps.rows.find((e: any) => e.employee_code === 'OP-001').id as string;
    const sid = emps.rows.find((e: any) => e.employee_code === 'OP-002').id as string;
    const p1 = prjs.rows.find((p: any) => p.project_code === 'PRJ-001');
    const p2 = prjs.rows.find((p: any) => p.project_code === 'PRJ-002');

    // Remove only previously seeded rows (real user entries have entered_by set).
    await c.query('DELETE FROM attendance_records WHERE tenant_id=$1 AND entered_by IS NULL', [tenantId]);

    for (let day = 1; day <= 31; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      const dow = new Date(date).getUTCDay();
      const isOff = dow === 0 || date === '2026-10-02' || date === '2026-10-20';
      const status = date === '2026-10-16' ? 'unpaid_leave' : isOff ? 'weekly_off' : 'present';
      const ot = day === 7 ? 4 : day === 14 ? 6 : 0;
      const project = day === 14 ? p2 : p1;
      await c.query(
        `INSERT INTO attendance_records (tenant_id,attendance_date,operator_id,project_id,
          net_working_minutes,net_working_hours,standard_working_minutes,overtime_hours,
          ot_rate_paise_per_hour,status,approval_status,entered_by,approved_by,approved_at)
         VALUES ($1,$2::date,$3,$4,$5,$6,600,$7,$8,$9,'approved',NULL,NULL,now())
         ON CONFLICT (tenant_id,operator_id,attendance_date) DO NOTHING`,
        [tenantId, date, rid, project.id, 600 + ot * 60, 10 + ot, ot, project.ot_rate_paise_per_hour, status],
      );
    }

    // one submitted record for Suresh to exercise approvals
    await c.query(
      `INSERT INTO attendance_records (tenant_id,attendance_date,operator_id,project_id,
        net_working_minutes,net_working_hours,standard_working_minutes,status,approval_status,entered_by)
       VALUES ($1,$2::date,$3,$4,600,10,600,'present','submitted',NULL)
       ON CONFLICT (tenant_id,operator_id,attendance_date) DO NOTHING`,
      [tenantId, DEMO_DATE, sid, p1.id],
    );

    // reminder rules
    await c.query(
      `INSERT INTO reminder_rules (tenant_id,category,lead_days)
       SELECT $1, unnest(ARRAY['emi','service','insurance','puc','fitness','license']::reminder_category[]), 15
       ON CONFLICT (tenant_id,category) DO NOTHING`,
      [tenantId],
    );
  });

  console.log(`Seeded tenant skyhook (${tenantId})`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  seed().then(() => pool.end()).catch((err) => { console.error(err); process.exitCode = 1; });
}
