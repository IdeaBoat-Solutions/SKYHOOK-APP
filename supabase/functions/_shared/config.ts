/** Supabase Edge Functions inject SUPABASE_URL / anon / service-role automatically. */
export const config = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  // Use the Supabase transaction pooler URI (port 6543) with sslmode=require.
  DATABASE_URL: Deno.env.get('DATABASE_URL') ?? '',
  // Restrict in production to the Vercel origin, e.g. https://skyhook.vercel.app.
  // Comma-separate several: https://skyhook.vercel.app,http://localhost:3000
  ALLOWED_ORIGIN: Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
  APP_TIMEZONE: Deno.env.get('APP_TIMEZONE') ?? 'Asia/Kolkata',
  DEMO_DATE: Deno.env.get('DEMO_DATE') ?? undefined,
} as const;

export function requireConfig(): void {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase URL/keys in function secrets');
  }
  if (!config.DATABASE_URL) throw new Error('Missing DATABASE_URL in function secrets');
}
