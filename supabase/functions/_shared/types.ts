import type { AuthContext } from './auth.ts';

export interface RouteCtx {
  url: URL;
  auth?: AuthContext;
  requestId: string;
  /** Named path params extracted from `:name` segments in Route.path. */
  params: Record<string, string>;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  public?: boolean;
  handler: (ctx: RouteCtx, req: Request) => Promise<Response>;
}
