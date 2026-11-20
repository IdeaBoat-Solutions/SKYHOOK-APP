-- Supabase incremental migration: machine servicing in operating hours.
-- Run in the SQL Editor if you already applied 0001_complete_setup.sql.
-- Fresh installs get this from 0001_complete_setup.sql and do NOT need this file.

ALTER TYPE frequency_unit ADD VALUE IF NOT EXISTS 'hours';

ALTER TABLE machines ADD COLUMN IF NOT EXISTS service_reminder_lead_hours NUMERIC NOT NULL DEFAULT 50;

COMMENT ON COLUMN machines.service_frequency_unit IS
  'days/months use next_service_due_date; hours uses summed approved working_hours since last_service_date.';
COMMENT ON COLUMN machines.next_service_due_date IS
  'NULL for hour-based servicing — due point is measured in operating hours.';
