import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // DDL/migrations should use the direct (non-pooled) connection on Supabase.
  DATABASE_URL_DIRECT: z.string().optional(),
  // PEM file (or inline PEM) of the CA that signed the database certificate.
  // Supabase uses its own root CA, which Node does not trust by default.
  DATABASE_SSL_CA: z.string().optional(),
  JWT_ISSUER: z.string().default('http://localhost:3001'),
  JWT_AUDIENCE: z.string().default('skyhook-api'),
  JWT_JWKS_URL: z.string().optional(),
  JWT_DEV_SECRET: z.string().min(16).default('local-development-secret-change-me-please-32b'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEMO_DATE: z.string().optional(),
  STORAGE_DIR: z.string().default('./storage'),
  RATE_LIMIT_READ: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WRITE: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(5),
  // --- Supabase platform (Auth + Storage; Postgres is reached via DATABASE_URL) ---
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('skyhook-documents'),
});

export const config = schema.parse(process.env);

/**
 * When a project URL and service-role key are present, the API uses Supabase Auth
 * (JWKS-verified access tokens) and Supabase Storage. Otherwise it falls back to
 * the local development stack (scrypt passwords, HS256 dev tokens, local files).
 */
export const supabaseMode = Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);

export const isDevAuth = !supabaseMode && (config.NODE_ENV !== 'production' || !config.JWT_JWKS_URL);
