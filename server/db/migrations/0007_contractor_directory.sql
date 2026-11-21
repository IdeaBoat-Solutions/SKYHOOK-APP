-- External / freelancer contractor and operator directory.
-- These are NOT workforce employees: they are contact records kept so a site can
-- call in extra operators and contractors when registered staff are unavailable.

CREATE TABLE IF NOT EXISTS contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contractor_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT 'crane_operator',
  agency_name TEXT,
  daily_rate_paise BIGINT NOT NULL DEFAULT 0,
  city TEXT,
  availability TEXT NOT NULL DEFAULT 'available',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contractor_code)
);

CREATE INDEX IF NOT EXISTS ix_contractors_tenant_skill ON contractors (tenant_id, skill);

ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'contractors'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON contractors
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
