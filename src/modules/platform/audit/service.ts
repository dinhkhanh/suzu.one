import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { addDays, type IsoDate } from "@/lib/dates";
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

export type AuditRow = typeof schema.auditLog.$inferSelect;

export type AuditFilters = {
  /** Part of an action name, e.g. "person." or ".denied". */
  action?: string;
  /** Part of the actor's email. */
  actor?: string;
  resourceType?: string;
  resourceId?: string;
  entityId?: string;
  from?: IsoDate;
  to?: IsoDate;
  page?: number;
};

export const AUDIT_PAGE_SIZE = 50;

const contains = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Newest first. `reach` comes from `entityReach(principal, "audit:read")`: an entity-scoped reader
 * sees that entity's entries only, and never the group-level ones (sign-ins, role grants).
 */
export async function listAuditEntries(reach: { all: true } | { all: false; entityIds: string[] }, filters: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  if (!reach.all && reach.entityIds.length === 0) return { rows: [], total: 0 };
  const log = schema.auditLog;
  const where = and(
    reach.all ? undefined : inArray(log.entityId, reach.entityIds),
    filters.action ? ilike(log.action, contains(filters.action)) : undefined,
    filters.actor ? ilike(log.actorEmail, contains(filters.actor)) : undefined,
    filters.resourceType ? eq(log.resourceType, filters.resourceType) : undefined,
    filters.resourceId ? eq(log.resourceId, filters.resourceId) : undefined,
    filters.entityId ? eq(log.entityId, filters.entityId) : undefined,
    // Days are Vietnamese calendar days.
    filters.from ? gte(log.occurredAt, new Date(`${filters.from}T00:00:00+07:00`)) : undefined,
    filters.to ? lt(log.occurredAt, new Date(`${addDays(filters.to, 1)}T00:00:00+07:00`)) : undefined,
  );
  const page = Math.max(1, filters.page ?? 1);
  const [rows, total] = await Promise.all([
    db().select().from(log).where(where).orderBy(desc(log.id)).limit(AUDIT_PAGE_SIZE).offset((page - 1) * AUDIT_PAGE_SIZE),
    db().$count(log, where),
  ]);
  return { rows, total };
}

/**
 * The filter's choices. A DISTINCT over the whole log is the slowest query on the page, and the
 * log only grows, so the list sits in the shared cache for a few minutes: a new type shows up late.
 */
export async function listAuditResourceTypes(): Promise<string[]> {
  return cached("audit:resource-types", 10 * 60, loadAuditResourceTypes);
}

async function loadAuditResourceTypes(): Promise<string[]> {
  const rows = await db().selectDistinct({ type: schema.auditLog.resourceType }).from(schema.auditLog).where(isNotNull(schema.auditLog.resourceType)).orderBy(asc(schema.auditLog.resourceType));
  return rows.flatMap((row) => (row.type ? [row.type] : []));
}
