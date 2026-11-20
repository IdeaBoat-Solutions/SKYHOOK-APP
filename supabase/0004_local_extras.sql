-- Tables live in the skyhook schema. The SQL Editor defaults to public, so set it
-- here; paste and run this whole file in ONE run.
SET search_path = skyhook, public;

-- Custom pay/deduction lines and per-user personal records that previously
-- lived only in browser localStorage. Forward-only and safe to re-run.

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,
  employee_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pay','deduction')),
  label TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_payroll_adjustments ON payroll_adjustments (tenant_id, month, employee_code);

CREATE TABLE IF NOT EXISTS personal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL DEFAULT 0,
  periodic_amount_paise BIGINT NOT NULL DEFAULT 0,
  start_date TEXT,
  due_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_personal_records_user ON personal_records (tenant_id, user_id);

ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_adjustments FORCE ROW LEVEL SECURITY;
-- PostgreSQL has no CREATE POLICY IF NOT EXISTS, so guard via the catalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'payroll_adjustments'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON payroll_adjustments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'personal_records'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON personal_records
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- payroll_adjustments grants come from 0002 (select/insert/delete only, by design).
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_records TO skyhook_app;
