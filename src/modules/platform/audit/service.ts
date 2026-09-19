import "server-only";
import { db, schema } from "@/lib/db";

export type AuditEntry = {
  action: string;
  actor?: { userId?: string | null; personId?: string | null; email?: string | null };
  resource?: { type: string; id?: string | null; entityId?: string | null };
  summary?: string;
  before?: unknown;
  after?: unknown;
  request?: { ipAddress?: string | null; userAgent?: string | null };
};

// Writes are insert-only; the table rejects UPDATE and DELETE at the database level.
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db().insert(schema.auditLog).values({
    action: entry.action,
    actorUserId: entry.actor?.userId ?? null,
    actorPersonId: entry.actor?.personId ?? null,
    actorEmail: entry.actor?.email ?? null,
    resourceType: entry.resource?.type ?? null,
    resourceId: entry.resource?.id ?? null,
    entityId: entry.resource?.entityId ?? null,
    summary: entry.summary ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipAddress: entry.request?.ipAddress ?? null,
    userAgent: entry.request?.userAgent ?? null,
  });
}
