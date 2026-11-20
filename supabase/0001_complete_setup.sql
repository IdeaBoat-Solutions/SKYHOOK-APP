-- ============================================================================
-- Skyhook ERP - SINGLE Supabase migration
-- Run this ONE file in the Supabase SQL Editor (as the `postgres` role).
--
-- Bundles, in dependency order:
--   1. supabase/roles.sql                    - dedicated non-BYPASSRLS app role
--   2. server/db/migrations/0001_init.sql    - full domain schema, RLS, views, triggers
--   3. server/db/migrations/0002_supabase.sql- auth_user_id, Storage bucket + policy
--
-- BEFORE RUNNING:
--   * Replace CHANGE_ME_TO_A_STRONG_PASSWORD in section 1 with a strong password.
--   * Use that SAME password in server/.env for DATABASE_URL and DATABASE_URL_DIRECT
--     (user `skyhook_app`), or the API will not be able to connect.
--   * Tables are created as `postgres`; FORCE RLS therefore applies to the API's
--     `skyhook_app` role (which is what matters), while `postgres` keeps BYPASSRLS.
--
-- Safe to re-run: every object is guarded by IF NOT EXISTS / catalog checks.
--
-- After running, fill in server/.env for Supabase mode:
--   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET
-- and (only for a future direct-to-Supabase SPA) root .env:
--   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
-- ============================================================================

BEGIN;

-- ###########################################################################
-- 1/3 - Application database role (from supabase/roles.sql)
-- ###########################################################################
-- OPTIONAL but recommended on Supabase: a dedicated, non-bypass-RLS DB role.
-- Created first in this combined migration; it is the role the API connects as.
-- Replace the password placeholder, then keep it only in your secret manager
-- and in DATABASE_URL / DATABASE_URL_DIRECT. Never commit the real value.

DO $$
DECLARE
  db_password TEXT := 'CHANGE_ME_TO_A_STRONG_PASSWORD';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyhook_app') THEN
    EXECUTE format('CREATE ROLE skyhook_app LOGIN PASSWORD %L', db_password);
  ELSE
    EXECUTE format('ALTER ROLE skyhook_app WITH LOGIN PASSWORD %L', db_password);
  END IF;
END $$;

-- Schema grants are applied after the schema/tables are created (section 2).

-- ###########################################################################
-- 2/3 - Domain schema (from server/db/migrations/0001_init.sql)
-- ###########################################################################
-- Skyhook ERP — Phase 1 schema
-- Derived from docs/07-DATABASE-DESIGN.md. Forward-only, idempotent on enums where possible.
-- FORCE ROW LEVEL SECURITY is applied so tenant isolation holds for the app role.


CREATE SCHEMA IF NOT EXISTS skyhook;
SET search_path TO skyhook, public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('owner','manager'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE employee_type AS ENUM ('operator','manager','supervisor','accounts','office','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE salary_type AS ENUM ('daily','monthly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE employment_status AS ENUM ('active','inactive','on_leave','terminated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE project_status AS ENUM ('upcoming','active','on_hold','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE attendance_status AS ENUM ('present','absent','half_day','paid_leave','unpaid_leave','weekly_off','holiday'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE approval_status AS ENUM ('draft','submitted','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE advance_status AS ENUM ('pending','approved','partially_recovered','fully_recovered','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payroll_status AS ENUM ('draft','under_review','approved','partially_paid','paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('unpaid','paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE asset_status AS ENUM ('available','assigned','under_maintenance','inactive','sold'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE machine_type AS ENUM ('hydraulic_crane','mobile_crane','crawler_crane','tower_crane','hydra','all_terrain_crane','rough_terrain_crane','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE emi_status AS ENUM ('upcoming','due_today','overdue','paid','partially_paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reminder_category AS ENUM ('emi','service','insurance','puc','fitness','license','payroll','attendance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE priority AS ENUM ('critical','high','medium','low'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE frequency_unit AS ENUM ('days','months'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_mode AS ENUM ('cash','bank_transfer','upi','cheque','company_card'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Identity & configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  demo_date DATE,
  migrated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  department TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  hash_version SMALLINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name user_role NOT NULL,
  label TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  PRIMARY KEY (tenant_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  name TEXT NOT NULL, tagline TEXT, logo_url TEXT,
  address TEXT, city TEXT, state TEXT, pincode TEXT,
  phone TEXT, email TEXT, gst_number TEXT,
  authorized_signatory TEXT, signatory_title TEXT,
  standard_shift_minutes INTEGER NOT NULL DEFAULT 600 CHECK (standard_shift_minutes BETWEEN 1 AND 1440),
  payroll_payment_day SMALLINT NOT NULL DEFAULT 15 CHECK (payroll_payment_day BETWEEN 1 AND 28),
  payroll_cycle_type TEXT NOT NULL DEFAULT 'calendar_month'
    CHECK (payroll_cycle_type IN ('calendar_month','custom_26_to_25')),
  short_shift_policy TEXT NOT NULL DEFAULT 'half_day_under_5'
    CHECK (short_shift_policy IN ('half_day_under_5','proportional','manual')),
  emi_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  service_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  insurance_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  puc_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  fitness_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  license_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, holiday_date)
);

-- ---------------------------------------------------------------------------
-- Workforce, projects, assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  employee_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  date_of_birth DATE,
  joining_date DATE NOT NULL,
  designation TEXT NOT NULL,
  employee_type employee_type NOT NULL,
  address TEXT,
  status employment_status NOT NULL DEFAULT 'active',
  profile_photo_key TEXT,
  remarks TEXT,
  salary_type salary_type NOT NULL,
  daily_rate_paise BIGINT NOT NULL DEFAULT 0 CHECK (daily_rate_paise >= 0),
  monthly_salary_paise BIGINT NOT NULL DEFAULT 0 CHECK (monthly_salary_paise >= 0),
  standard_shift_minutes INTEGER NOT NULL DEFAULT 600,
  overtime_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  salary_effective_date DATE NOT NULL,
  license_number TEXT,
  crane_license_issue_date DATE,
  crane_license_expiry DATE,
  transport_license_issue_date DATE,
  transport_license_expiry DATE,
  current_project_id UUID,
  current_machine_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, employee_code)
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mobile TEXT NOT NULL, relation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('employee','machine','expense','emi','payroll')),
  owner_id UUID NOT NULL,
  doc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  size_kb INTEGER,
  mime_type TEXT,
  expiry_date DATE,
  scanned_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_documents_owner ON documents (tenant_id, owner_type, owner_id);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_code TEXT NOT NULL,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,
  location TEXT, site_address TEXT, city TEXT, state TEXT,
  start_date DATE NOT NULL,
  expected_end_date DATE NOT NULL,
  actual_end_date DATE,
  manager_id UUID REFERENCES users(id),
  description TEXT,
  ot_rate_paise_per_hour BIGINT NOT NULL DEFAULT 0 CHECK (ot_rate_paise_per_hour >= 0),
  contract_value_paise BIGINT,
  status project_status NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, project_code)
);

CREATE TABLE IF NOT EXISTS project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  operator_id UUID NOT NULL REFERENCES employees(id),
  machine_id UUID,
  start_date DATE NOT NULL, end_date DATE,
  notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS ix_project_assignments_active ON project_assignments (tenant_id, project_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS project_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  expense_code TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id),
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  payment_mode payment_mode NOT NULL,
  paid_by TEXT NOT NULL,
  vendor TEXT, receipt_number TEXT, receipt_key TEXT,
  approval_status approval_status NOT NULL DEFAULT 'draft',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, expense_code)
);

CREATE TABLE IF NOT EXISTS machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  asset_code TEXT NOT NULL,
  machine_type machine_type NOT NULL,
  make TEXT NOT NULL, model TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  serial_number TEXT,
  tonnage_capacity NUMERIC(6,2),
  purchase_date DATE, purchase_cost_paise BIGINT,
  photo_key TEXT,
  current_project_id UUID REFERENCES projects(id),
  assigned_operator_id UUID REFERENCES employees(id),
  status asset_status NOT NULL DEFAULT 'available',
  last_service_date DATE,
  service_frequency_value INTEGER NOT NULL DEFAULT 60,
  service_frequency_unit frequency_unit NOT NULL DEFAULT 'days',
  next_service_due_date DATE,
  service_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  insurance_provider TEXT, insurance_policy_number TEXT,
  insurance_start_date DATE, insurance_expiry_date DATE,
  insurance_interval_days INTEGER DEFAULT 365,
  insurance_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  puc_number TEXT, puc_issue_date DATE, puc_expiry_date DATE,
  puc_interval_days INTEGER DEFAULT 180,
  puc_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  fitness_certificate_number TEXT, last_fitness_date DATE,
  next_fitness_due_date DATE, fitness_interval_days INTEGER DEFAULT 365,
  fitness_reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, asset_code),
  UNIQUE (tenant_id, registration_number)
);

CREATE TABLE IF NOT EXISTS service_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  machine_id UUID NOT NULL REFERENCES machines(id),
  service_date DATE NOT NULL,
  service_type TEXT NOT NULL,
  service_provider TEXT,
  cost_paise BIGINT NOT NULL DEFAULT 0,
  odometer_or_hours NUMERIC(9,2),
  notes TEXT, invoice_key TEXT,
  completed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_service_records_machine ON service_records (tenant_id, machine_id, service_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_employees_current_project') THEN
    ALTER TABLE employees ADD CONSTRAINT fk_employees_current_project FOREIGN KEY (current_project_id) REFERENCES projects(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_employees_current_machine') THEN
    ALTER TABLE employees ADD CONSTRAINT fk_employees_current_machine FOREIGN KEY (current_machine_id) REFERENCES machines(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_project_assignments_machine') THEN
    ALTER TABLE project_assignments ADD CONSTRAINT fk_project_assignments_machine FOREIGN KEY (machine_id) REFERENCES machines(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS compliance_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category reminder_category NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('machine','employee')),
  target_id UUID NOT NULL,
  renewal_date DATE NOT NULL,
  previous_expiry DATE,
  new_expiry DATE NOT NULL,
  provider TEXT, reference_number TEXT,
  document_key TEXT,
  recorded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_compliance_target ON compliance_renewals (tenant_id, target_type, target_id, new_expiry DESC);

-- ---------------------------------------------------------------------------
-- EMI
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emi_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_code TEXT NOT NULL,
  machine_id UUID NOT NULL REFERENCES machines(id),
  loan_provider TEXT NOT NULL,
  loan_ref_number TEXT NOT NULL,
  loan_start_date DATE NOT NULL, loan_end_date DATE NOT NULL,
  emi_amount_paise BIGINT NOT NULL CHECK (emi_amount_paise > 0),
  monthly_due_day SMALLINT NOT NULL CHECK (monthly_due_day BETWEEN 1 AND 28),
  total_installments INTEGER NOT NULL CHECK (total_installments > 0),
  installments_paid INTEGER NOT NULL DEFAULT 0,
  next_emi_date DATE,
  reminder_lead_days SMALLINT NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (tenant_id, loan_code),
  CHECK (installments_paid <= total_installments)
);

CREATE TABLE IF NOT EXISTS emi_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id UUID NOT NULL REFERENCES emi_loans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  due_date DATE NOT NULL,
  amount_due_paise BIGINT NOT NULL,
  amount_paid_paise BIGINT NOT NULL DEFAULT 0,
  status emi_status NOT NULL DEFAULT 'upcoming',
  paid_at TIMESTAMPTZ, paid_by UUID REFERENCES users(id),
  payment_mode payment_mode, payment_reference TEXT, proof_key TEXT,
  remarks TEXT,
  UNIQUE (tenant_id, loan_id, installment_number),
  CHECK (amount_paid_paise <= amount_due_paise)
);

CREATE TABLE IF NOT EXISTS emi_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id UUID NOT NULL REFERENCES emi_loans(id),
  installment_id UUID NOT NULL REFERENCES emi_installments(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_date DATE NOT NULL,
  payment_mode payment_mode NOT NULL,
  payment_reference TEXT,
  proof_key TEXT,
  recorded_by UUID REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Attendance & machine operations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  attendance_date DATE NOT NULL,
  operator_id UUID NOT NULL REFERENCES employees(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  machine_id UUID REFERENCES machines(id),
  start_time TIME, end_time TIME,
  unpaid_break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (unpaid_break_minutes >= 0),
  net_working_minutes INTEGER NOT NULL DEFAULT 0,
  net_working_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  standard_working_minutes INTEGER NOT NULL DEFAULT 600,
  overtime_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  ot_rate_paise_per_hour BIGINT NOT NULL DEFAULT 0,
  status attendance_status NOT NULL,
  approval_status approval_status NOT NULL DEFAULT 'draft',
  remarks TEXT,
  entered_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, operator_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS ix_attendance_month ON attendance_records (tenant_id, attendance_date) WHERE approval_status = 'approved';
CREATE INDEX IF NOT EXISTS ix_attendance_project ON attendance_records (tenant_id, project_id, attendance_date);

CREATE TABLE IF NOT EXISTS attendance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  attendance_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id),
  start_time TIME NOT NULL, end_time TIME NOT NULL,
  unpaid_break_minutes INTEGER NOT NULL DEFAULT 0,
  net_minutes INTEGER NOT NULL,
  standard_minutes_allocated INTEGER NOT NULL,
  overtime_minutes INTEGER NOT NULL,
  ot_rate_paise_per_hour BIGINT NOT NULL,
  ot_amount_paise BIGINT NOT NULL,
  UNIQUE (tenant_id, attendance_id, project_id)
);

CREATE TABLE IF NOT EXISTS machine_working_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  log_date DATE NOT NULL,
  machine_id UUID NOT NULL REFERENCES machines(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  operator_id UUID REFERENCES employees(id),
  start_time TIME NOT NULL, end_time TIME NOT NULL,
  idle_minutes INTEGER NOT NULL DEFAULT 0,
  working_minutes INTEGER NOT NULL,
  working_hours NUMERIC(7,2) NOT NULL,
  remarks TEXT,
  approval_status approval_status NOT NULL DEFAULT 'draft',
  entered_by UUID REFERENCES users(id),
  import_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_machine_logs_date ON machine_working_logs (tenant_id, log_date);
CREATE INDEX IF NOT EXISTS ix_machine_logs_machine ON machine_working_logs (tenant_id, machine_id, log_date);

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('machine_working','attendance')),
  file_key TEXT NOT NULL,
  total_rows INTEGER NOT NULL, valid_rows INTEGER NOT NULL, rejected_rows INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','committed','rolled_back')),
  error_report_key TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Advances & payroll
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  advance_code TEXT NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id),
  advance_date DATE NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_mode payment_mode NOT NULL,
  payment_reference TEXT,
  project_id UUID REFERENCES projects(id),
  remarks TEXT,
  approved_by UUID REFERENCES users(id),
  recovery_paise BIGINT NOT NULL DEFAULT 0,
  outstanding_paise BIGINT NOT NULL,
  status advance_status NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, advance_code),
  CHECK (recovery_paise <= amount_paise),
  CHECK (outstanding_paise = amount_paise - recovery_paise)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_code TEXT NOT NULL,
  month DATE NOT NULL,
  period_start DATE NOT NULL, period_end DATE NOT NULL,
  payment_due_date DATE NOT NULL,
  status payroll_status NOT NULL DEFAULT 'draft',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ, approved_by UUID REFERENCES users(id),
  employee_count INTEGER NOT NULL DEFAULT 0,
  total_base_paise BIGINT NOT NULL DEFAULT 0,
  total_ot_paise BIGINT NOT NULL DEFAULT 0,
  total_allowances_paise BIGINT NOT NULL DEFAULT 0,
  total_gross_paise BIGINT NOT NULL DEFAULT 0,
  total_advance_recovery_paise BIGINT NOT NULL DEFAULT 0,
  total_other_deductions_paise BIGINT NOT NULL DEFAULT 0,
  total_net_paise BIGINT NOT NULL DEFAULT 0,
  total_paid_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, run_code),
  UNIQUE (tenant_id, month)
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  employee_code TEXT NOT NULL, employee_name TEXT NOT NULL, designation TEXT,
  salary_type salary_type NOT NULL,
  applied_daily_rate_paise BIGINT NOT NULL DEFAULT 0,
  applied_monthly_rate_paise BIGINT NOT NULL DEFAULT 0,
  standard_shift_minutes INTEGER NOT NULL DEFAULT 600,
  total_days_in_month INTEGER NOT NULL,
  present_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  half_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  paid_leave_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  unpaid_leave_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  weekly_off_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  holiday_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  payable_days NUMERIC(5,2) NOT NULL,
  base_paise BIGINT NOT NULL,
  total_ot_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  ot_paise BIGINT NOT NULL DEFAULT 0,
  allowances_paise BIGINT NOT NULL DEFAULT 0,
  gross_paise BIGINT NOT NULL,
  advance_recovery_paise BIGINT NOT NULL DEFAULT 0,
  other_deductions_paise BIGINT NOT NULL DEFAULT 0,
  total_deductions_paise BIGINT NOT NULL,
  net_paise BIGINT NOT NULL,
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  payment_date DATE, payment_mode payment_mode, payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS advance_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  advance_id UUID NOT NULL REFERENCES salary_advances(id),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id),
  payroll_entry_id UUID NOT NULL REFERENCES payroll_entries(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  recovery_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payroll_run_id, advance_id)
);

CREATE TABLE IF NOT EXISTS payroll_ot_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payroll_entry_id UUID NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id),
  project_name TEXT NOT NULL,
  ot_hours NUMERIC(7,2) NOT NULL,
  ot_rate_paise_per_hour BIGINT NOT NULL,
  amount_paise BIGINT NOT NULL,
  UNIQUE (tenant_id, payroll_entry_id, project_id)
);

-- ---------------------------------------------------------------------------
-- Notifications, audit & infrastructure
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminder_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category reminder_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  lead_days SMALLINT NOT NULL DEFAULT 15,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app'],
  UNIQUE (tenant_id, category)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category reminder_category NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL,
  related_entity TEXT NOT NULL, related_id UUID NOT NULL,
  due_date DATE,
  priority priority NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  recipients UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_notifications_unread ON notifications (tenant_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email BOOLEAN NOT NULL DEFAULT TRUE,
  sms BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start TIME, quiet_hours_end TIME
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID, actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  previous_value JSONB, updated_value JSONB, reason TEXT,
  request_id UUID, ip_address INET, user_agent TEXT,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL, aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_outbox_unpublished ON outbox (published_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, key, endpoint)
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,
  parameters JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result_key TEXT,
  error TEXT,
  requested_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
           WHERE c.table_schema = 'skyhook' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
           GROUP BY c.table_name LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated ON skyhook.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON skyhook.%I FOR EACH ROW EXECUTE FUNCTION skyhook.set_updated_at()', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_locked_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT locked FROM skyhook.payroll_runs WHERE id = OLD.payroll_run_id) THEN
    IF NEW.base_paise IS DISTINCT FROM OLD.base_paise
       OR NEW.gross_paise IS DISTINCT FROM OLD.gross_paise
       OR NEW.net_paise IS DISTINCT FROM OLD.net_paise THEN
      RAISE EXCEPTION 'payroll entry is locked';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payroll_entries_lock ON payroll_entries;
CREATE TRIGGER trg_payroll_entries_lock BEFORE UPDATE ON payroll_entries
  FOR EACH ROW EXECUTE FUNCTION guard_locked_payroll();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_employee_month_ot AS
SELECT tenant_id, operator_id AS employee_id,
       date_trunc('month', attendance_date)::date AS month,
       SUM(overtime_hours) AS total_ot_hours,
       SUM(ROUND(overtime_hours * ot_rate_paise_per_hour))::bigint AS ot_paise
FROM attendance_records
WHERE approval_status = 'approved'
GROUP BY 1,2,3;

CREATE OR REPLACE VIEW v_upcoming_renewals AS
SELECT tenant_id, 'machine'::text AS target_type, id AS target_id,
       asset_code AS reference, 'insurance'::reminder_category AS category,
       insurance_expiry_date AS due_date
FROM machines WHERE insurance_expiry_date IS NOT NULL
UNION ALL SELECT tenant_id, 'machine', id, asset_code, 'puc', puc_expiry_date FROM machines WHERE puc_expiry_date IS NOT NULL
UNION ALL SELECT tenant_id, 'machine', id, asset_code, 'fitness', next_fitness_due_date FROM machines WHERE next_fitness_due_date IS NOT NULL
UNION ALL SELECT tenant_id, 'machine', id, asset_code, 'service', next_service_due_date FROM machines WHERE next_service_due_date IS NOT NULL
UNION ALL SELECT tenant_id, 'employee', id, employee_code, 'license', crane_license_expiry FROM employees WHERE crane_license_expiry IS NOT NULL;

CREATE OR REPLACE VIEW v_payroll_summary AS
SELECT r.id AS run_id, r.tenant_id, r.run_code, r.status,
       COUNT(e.id) AS employee_count,
       COALESCE(SUM(e.base_paise),0) AS total_base_paise,
       COALESCE(SUM(e.ot_paise),0) AS total_ot_paise,
       COALESCE(SUM(e.gross_paise),0) AS total_gross_paise,
       COALESCE(SUM(e.advance_recovery_paise),0) AS total_recovery_paise,
       COALESCE(SUM(e.net_paise),0) AS total_net_paise
FROM payroll_runs r LEFT JOIN payroll_entries e ON e.payroll_run_id = r.id
GROUP BY 1,2,3,4;

-- ---------------------------------------------------------------------------
-- Row-Level Security (FORCE so it also applies to the owner role)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
           WHERE c.table_schema = 'skyhook' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
           GROUP BY c.table_name LOOP
    EXECUTE format('ALTER TABLE skyhook.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE skyhook.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON skyhook.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON skyhook.%I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $p$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Grants for the application role (if it has been provisioned by the platform)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyhook_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA skyhook TO skyhook_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA skyhook TO skyhook_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA skyhook TO skyhook_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA skyhook GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skyhook_app';
  END IF;
END $$;


-- Grants for the app role (schema + tables now exist).
GRANT USAGE ON SCHEMA skyhook TO skyhook_app;
GRANT USAGE ON SCHEMA public TO skyhook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA skyhook TO skyhook_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA skyhook TO skyhook_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA skyhook
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skyhook_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA skyhook
  GRANT USAGE, SELECT ON SEQUENCES TO skyhook_app;

-- ###########################################################################
-- 3/3 - Supabase Auth + Storage additions (from 0002_supabase.sql)
-- ###########################################################################
-- Skyhook ERP — Supabase provider additions.
-- Safe to apply to both local Postgres and Supabase: platform-only objects are
-- guarded by catalog checks. Run after 0001_init.sql.
--
-- On Supabase, a dedicated non-BYPASSRLS app role should be created first
-- (see supabase/roles.sql) so FORCE RLS is actually enforced for API queries.


SET search_path TO skyhook, public;

-- Link each internal user to their Supabase Auth identity.
ALTER TABLE skyhook.users ADD COLUMN IF NOT EXISTS auth_user_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_auth_user_id
  ON skyhook.users (auth_user_id) WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN skyhook.users.auth_user_id IS
  'Supabase auth.users.id; tenant + role claims are embedded in the signed access token.';

-- ---------------------------------------------------------------------------
-- Supabase Storage bucket (private, 10 MB — mirrors the API upload limit)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('skyhook-documents', 'skyhook-documents', false, 10485760)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Direct client access to the bucket is scoped to the caller's tenant folder.
-- The API itself uses the service-role key, which bypasses these policies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS skyhook_tenant_storage ON storage.objects;
    CREATE POLICY skyhook_tenant_storage ON storage.objects
      FOR ALL TO authenticated
      USING (
        bucket_id = 'skyhook-documents'
        AND (storage.foldername(name))[1] = 'tenant'
        AND (storage.foldername(name))[2] =
            coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')
      )
      WITH CHECK (
        bucket_id = 'skyhook-documents'
        AND (storage.foldername(name))[1] = 'tenant'
        AND (storage.foldername(name))[2] =
            coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')
      );
  END IF;
END $$;


COMMIT;
