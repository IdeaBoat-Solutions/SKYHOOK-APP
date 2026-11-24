-- Driving-licence details captured from a scanned licence (OCR) or typed in by hand.
-- Forward-only and safe to re-run.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS guardian_name TEXT,                 -- Son/Daughter/Wife of
  ADD COLUMN IF NOT EXISTS blood_group TEXT,
  ADD COLUMN IF NOT EXISTS license_issue_date DATE,
  ADD COLUMN IF NOT EXISTS license_valid_nt DATE,              -- validity, non-transport
  ADD COLUMN IF NOT EXISTS license_valid_tr DATE,              -- validity, transport
  ADD COLUMN IF NOT EXISTS license_first_issue_date DATE,
  ADD COLUMN IF NOT EXISTS license_issuing_state TEXT,
  ADD COLUMN IF NOT EXISTS license_issuing_authority TEXT,     -- RTO / licensing authority
  ADD COLUMN IF NOT EXISTS license_vehicle_classes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS organ_donor BOOLEAN,
  ADD COLUMN IF NOT EXISTS license_scanned_at TIMESTAMPTZ;
