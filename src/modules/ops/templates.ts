// The obligation library (FR-OPS-01, 03): the group's list of recurring and event-driven duties.
// Seeded as a draft (`unreviewed`); the chief accountant and the HR lead go through it and mark
// each template reviewed. Editing a template puts it back to unreviewed unless the editor says
// the change is the review.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { ROLES } from "../platform/rbac/roles";
import { type DueRule, ruleProblems } from "./engine/due-rule";
import { AUTHORITIES, type Escalation, EVENT_TYPES, type EvidenceRequirement, OBLIGATION_CATEGORIES, type ObligationLink, PARTY_RULE, RECURRENCES, SHIFTS } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type ObligationTemplateRow = typeof schema.obligationTemplate.$inferSelect;

export type TemplateInput = {
  code: string;
  name: string;
  category: string;
  authority: string;
  recurrence: string;
  dueRule: DueRule;
  shift: string;
  eventType: string | null;
  entityIds: string[] | null;
  ownerRule: string;
  ownerPersonId: string | null;
  reviewerRule: string;
  reviewerPersonId: string | null;
  checklist: string[];
  guidance: string | null;
  links: ObligationLink[];
  reminderLeadDays: number[];
  escalation: Escalation;
  evidence: EvidenceRequirement;
  penaltyNote: string | null;
  isActive: boolean;
};

// The library is company reference data (no personal data) that changes a few times a year: the
// whole table sits in the shared cache. Both writers below drop it once their change is committed;
// the TTL covers the seed scripts, which write behind the app's back.
const TEMPLATES_CACHE = "ops:templates";
const TEMPLATES_TTL = 60 * 60;

/** Every template. Inside a transaction pass it, and the rows come from that transaction, not the cache. */
export async function listTemplates(executor?: Executor): Promise<ObligationTemplateRow[]> {
  const load = (from: Executor) => from.select().from(schema.obligationTemplate).orderBy(asc(schema.obligationTemplate.category), asc(schema.obligationTemplate.sortOrder), asc(schema.obligationTemplate.name));
  return executor ? load(executor) : cached(TEMPLATES_CACHE, TEMPLATES_TTL, () => load(db()));
}

export async function findTemplate(templateId: string, executor: Executor = db()): Promise<ObligationTemplateRow | undefined> {
  const [row] = await executor.select().from(schema.obligationTemplate).where(eq(schema.obligationTemplate.id, templateId)).limit(1);
  return row;
}

function partyProblem(rule: string, personId: string | null, which: "owner" | "reviewer"): string | null {
  if (!PARTY_RULE.test(rule)) return `template_${which}_rule_invalid`;
  if (rule === "none" && which === "owner") return "template_owner_rule_invalid";
  if (rule === "person" && !personId) return `template_${which}_person_required`;
  if (rule.startsWith("role:") && !(ROLES as readonly string[]).includes(rule.slice(5))) return `template_${which}_rule_invalid`;
  return null;
}

/** The first thing wrong with a template, as a message key; null = fine. Also used by the seed's test. */
export function templateProblem(input: TemplateInput): string | null {
  if (!(OBLIGATION_CATEGORIES as readonly string[]).includes(input.category)) return "template_category_invalid";
  if (!(AUTHORITIES as readonly string[]).includes(input.authority)) return "template_authority_invalid";
  if (!(RECURRENCES as readonly string[]).includes(input.recurrence)) return "template_recurrence_invalid";
  if (!(SHIFTS as readonly string[]).includes(input.shift)) return "template_shift_invalid";
  const rule = ruleProblems(input.dueRule, input.recurrence);
  if (rule.length) return `template_${rule[0]}`;
  if (input.recurrence === "event" ? !(EVENT_TYPES as readonly string[]).includes(input.eventType ?? "") : input.eventType !== null) return "template_event_type_invalid";
  if (input.links.some((link) => !/^https:\/\//.test(link.url))) return "template_link_invalid";
  if (input.reminderLeadDays.some((days) => !Number.isInteger(days) || days < 0 || days > 120)) return "template_lead_days_invalid";
  if (input.escalation.managerAfterDays < 0 || input.escalation.executiveAfterDays < input.escalation.managerAfterDays) return "template_escalation_invalid";
  return partyProblem(input.ownerRule, input.ownerPersonId, "owner") ?? partyProblem(input.reviewerRule, input.reviewerPersonId, "reviewer");
}

export async function saveTemplate(templateId: string | null, input: TemplateInput, options: { keepReviewed?: boolean } = {}): Promise<{ before: ObligationTemplateRow | null; after: ObligationTemplateRow }> {
  const problem = templateProblem(input);
  if (problem) throw new ActionError(problem);
  const values = { ...input, ownerPersonId: input.ownerRule === "person" ? input.ownerPersonId : null, reviewerPersonId: input.reviewerRule === "person" ? input.reviewerPersonId : null, entityIds: input.entityIds?.length ? input.entityIds : null, reminderLeadDays: [...new Set(input.reminderLeadDays)].sort((a, b) => b - a) };
  const saved = await db().transaction(async (tx) => {
    const [clash] = await tx.select({ id: schema.obligationTemplate.id }).from(schema.obligationTemplate).where(eq(schema.obligationTemplate.code, input.code)).limit(1);
    if (clash && clash.id !== templateId) throw new ActionError("template_code_taken");
    if (!templateId) {
      const [after] = await tx.insert(schema.obligationTemplate).values(values).returning();
      return { before: null, after };
    }
    const before = await findTemplate(templateId, tx);
    if (!before) throw new ActionError("template_not_found");
    // A changed rule is a new claim about the law: it needs looking at again.
    const review = options.keepReviewed ? {} : { reviewStatus: "unreviewed", reviewedByPersonId: null, reviewedAt: null };
    const [after] = await tx.update(schema.obligationTemplate).set({ ...values, ...review, updatedAt: new Date() }).where(eq(schema.obligationTemplate.id, templateId)).returning();
    return { before, after };
  });
  await invalidate(TEMPLATES_CACHE);
  return saved;
}

export async function setReviewStatus(templateId: string, reviewed: boolean, actorPersonId: string): Promise<{ before: ObligationTemplateRow; after: ObligationTemplateRow }> {
  const before = await findTemplate(templateId);
  if (!before) throw new ActionError("template_not_found");
  const [after] = await db()
    .update(schema.obligationTemplate)
    .set(reviewed ? { reviewStatus: "reviewed", reviewedByPersonId: actorPersonId, reviewedAt: new Date(), updatedAt: new Date() } : { reviewStatus: "unreviewed", reviewedByPersonId: null, reviewedAt: null, updatedAt: new Date() })
    .where(eq(schema.obligationTemplate.id, templateId))
    .returning();
  await invalidate(TEMPLATES_CACHE);
  return { before, after };
}
