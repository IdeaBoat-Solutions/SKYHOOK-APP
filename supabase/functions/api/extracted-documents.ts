/** Read-only access to structured data extracted from the scanned document PDFs. */
import { withTenantRead } from '../_shared/db.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { json } from '../_shared/http.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

const DOCUMENT_COLUMNS = `id, doc_type, title, source_file, natural_key, entity_name,
  vehicle_number, issue_date, expiry_date, amount_paise, amount_label, details,
  scanned_at, created_at, updated_at`;

/** pg returns JSONB as an object with npm:pg, but tolerate a string too. */
function parseDetails(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function toDocument(r: any) {
  return {
    id: r.id,
    docType: r.doc_type,
    title: r.title,
    sourceFile: r.source_file,
    naturalKey: r.natural_key,
    entityName: r.entity_name,
    vehicleNumber: r.vehicle_number,
    issueDate: r.issue_date,
    expiryDate: r.expiry_date,
    amountPaise: r.amount_paise,
    amountLabel: r.amount_label,
    details: parseDetails(r.details),
    scannedAt: r.scanned_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const extractedDocumentsRoutes: Route[] = [
  {
    method: 'GET',
    path: '/extracted-documents',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');

      // Optional ?type=loan_sanction|fitness_certificate|insurance_quote|tax_receipt
      const type = ctx.url.searchParams.get('type');
      const items = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT ${DOCUMENT_COLUMNS} FROM extracted_documents
           WHERE tenant_id = $1 AND ($2::text IS NULL OR doc_type = $2)
           ORDER BY CASE doc_type
             WHEN 'loan_sanction' THEN 1
             WHEN 'fitness_certificate' THEN 2
             WHEN 'insurance_quote' THEN 3
             ELSE 4
           END, natural_key`,
          [auth.tenantId, type],
        );
        return r.rows.map(toDocument);
      });
      return json({ items });
    },
  },
];
