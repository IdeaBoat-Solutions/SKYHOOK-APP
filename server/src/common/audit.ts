import type { PoolClient } from 'pg';
import type { AuthContext } from '../auth/context.js';

export interface AuditInput {
  action: string;
  entity: string;
  entityId: string;
  reason?: string;
  previousValue?: unknown;
  updatedValue?: unknown;
  requestId?: string;
}

/** Append an immutable audit row and domain event in the SAME transaction. */
export async function writeAudit(
  client: PoolClient,
  auth: AuthContext,
  input: AuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_name, action, entity, entity_id,
                             previous_value, updated_value, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      auth.tenantId,
      auth.userId,
      auth.name,
      input.action,
      input.entity,
      input.entityId,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.updatedValue === undefined ? null : JSON.stringify(input.updatedValue),
      input.reason ?? null,
      input.requestId ?? null,
    ],
  );
  await client.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      auth.tenantId,
      input.action,
      input.entity,
      input.entityId,
      JSON.stringify({ reason: input.reason ?? null, at: new Date().toISOString() }),
    ],
  );
}
