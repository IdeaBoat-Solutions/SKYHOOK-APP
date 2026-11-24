
-- Registration certificate (RC) details captured from a scanned RC (OCR) or typed in
-- by hand: chassis/engine numbers, registration validity, owner, financier, specs.
-- One JSON object because the RC carries ~25 descriptive fields that are shown and
-- edited together but never queried individually. Forward-only and safe to re-run.

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS rc_details JSONB NOT NULL DEFAULT '{}'::jsonb;
