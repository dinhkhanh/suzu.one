// Feedback about SuZu One itself: bugs, ideas, questions and praise from anyone who uses it, and
// the triage of them. The submitter sees their own items and the reply; `feedback:manage` works
// the inbox for the people its grant covers; `feedback:read` reads it.
import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";

export const feedbackCategory = pgEnum("feedback_category", ["bug", "idea", "question", "praise", "other"]);
export const feedbackStatus = pgEnum("feedback_status", ["new", "in_progress", "resolved", "declined"]);
export const feedbackPriority = pgEnum("feedback_priority", ["low", "normal", "high", "urgent"]);

export const appFeedback = pgTable(
  "app_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    // The submitter's entity when they wrote it, for the audit log's entity filter.
    entityId: uuid("entity_id").references(() => entity.id),
    category: feedbackCategory("category").notNull(),
    // Plain text. Shown as paragraphs; never parsed as HTML.
    message: text("message").notNull(),
    // "It stops me doing my job" — the submitter's own say, beside the priority triage sets.
    blocking: boolean("blocking").notNull().default(false),
    // The page the feedback button was pressed on, and its first segment for grouping.
    pagePath: text("page_path"),
    area: text("area"),
    userAgent: text("user_agent"),
    // A `stored_file` owned by the submitter (FEEDBACK_SCREENSHOT_OWNER_TYPE). No foreign key: the
    // files module owns its table and is reached through its service.
    screenshotFileId: uuid("screenshot_file_id"),
    status: feedbackStatus("status").notNull().default("new"),
    priority: feedbackPriority("priority").notNull().default("normal"),
    // Shown to the submitter.
    reply: text("reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    // For the people who triage only.
    internalNote: text("internal_note"),
    handledByPersonId: uuid("handled_by_person_id").references(() => person.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_feedback_person_idx").on(t.personId, t.createdAt), index("app_feedback_status_idx").on(t.status, t.createdAt)],
).enableRLS();
