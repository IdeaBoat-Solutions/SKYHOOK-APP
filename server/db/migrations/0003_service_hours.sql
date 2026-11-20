-- Machine servicing in operating hours (instead of calendar days).
-- Forward-only, safe to re-run.

-- 'hours' lets machines declare an hour-based service interval.
ALTER TYPE frequency_unit ADD VALUE IF NOT EXISTS 'hours';

-- Lead time for hour-based service reminders (operating hours before due).
ALTER TABLE machines ADD COLUMN IF NOT EXISTS service_reminder_lead_hours NUMERIC NOT NULL DEFAULT 50;

COMMENT ON COLUMN machines.service_frequency_unit IS
  'days/months use next_service_due_date; hours uses summed approved working_hours since last_service_date.';
COMMENT ON COLUMN machines.next_service_due_date IS
  'NULL for hour-based servicing — due point is measured in operating hours.';
