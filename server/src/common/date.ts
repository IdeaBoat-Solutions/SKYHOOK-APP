import { config } from '../config.js';

/**
 * Business "today" in the company's timezone (India by default), as yyyy-mm-dd.
 * DEMO_DATE can pin it for a scripted demo, but only outside production.
 */
export function businessDate(): string {
  if (config.DEMO_DATE && config.NODE_ENV !== 'production') return config.DEMO_DATE;
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.APP_TIMEZONE }).format(new Date());
}
