export interface AuthContext {
  /** Internal skyhook.users.id — used for foreign keys and audit rows. */
  userId: string;
  /** Supabase auth.users.id — present when Supabase Auth is configured. */
  authUserId?: string;
  tenantId: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  requestId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}
