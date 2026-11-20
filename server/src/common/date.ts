import { config } from '../config.js';

/** Business "today" — DEMO_DATE overrides for deterministic demos, otherwise today (UTC date). */
export function businessDate(): string {
  return config.DEMO_DATE ?? new Date().toISOString().split('T')[0]!;
}
