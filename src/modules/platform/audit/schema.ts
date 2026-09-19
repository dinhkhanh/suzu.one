import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Append-only. A database trigger (see drizzle/*_audit_log_append_only.sql) rejects UPDATE and DELETE.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text("actor_user_id"),
    actorPersonId: uuid("actor_person_id"),
    actorEmail: text("actor_email"),
    // e.g. "entity.create", "auth.sign_in.rejected", "person.compensation.read"
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    entityId: uuid("entity_id"),
    summary: text("summary"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_log_occurred_at_idx").on(t.occurredAt),
    index("audit_log_actor_idx").on(t.actorPersonId),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
).enableRLS();
