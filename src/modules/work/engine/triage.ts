// Triage rules (FR-PJM-32): what work arriving from outside a team gets on arrival. Pure — the
// service loads the team's rules and the task, this decides; the lead still accepts or declines.
import { toSearchKey } from "@/lib/text";

export const TRIAGE_SOURCES = ["intake", "handoff", "request"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];
/** null = made by the team itself, never in triage. */
export const TRIAGE_STATUSES = ["pending", "snoozed", "accepted", "declined", "merged"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export type TriageMatchDef = { source?: string; intakeFormId?: string; keyword?: string };
export type TriageSetDef = { assigneePersonId?: string; projectId?: string; labelIds?: string[]; priority?: number };
export type TriageRuleDef = { id: string; match: TriageMatchDef; set: TriageSetDef; sortOrder: number; isActive: boolean };
export type TriageArrival = { source: string; intakeFormId: string | null; title: string; description: string | null };

export type TriageRuleProblem = "triage_rule_sets_nothing" | "triage_rule_source_invalid";

export function triageRuleProblem(rule: { match: TriageMatchDef; set: TriageSetDef }): TriageRuleProblem | null {
  if (rule.match.source && !(TRIAGE_SOURCES as readonly string[]).includes(rule.match.source)) return "triage_rule_source_invalid";
  const { assigneePersonId, projectId, labelIds, priority } = rule.set;
  return assigneePersonId || projectId || (labelIds && labelIds.length > 0) || priority ? null : "triage_rule_sets_nothing";
}

/**
 * Every condition a rule names must hold; a rule that names none catches everything. A keyword
 * is a comma-separated list of alternatives ("video, clip"); an alternative matches when all of
 * its words are in the title or the brief, accents and case aside.
 */
export function ruleMatches(match: TriageMatchDef, arrival: TriageArrival): boolean {
  if (match.source && match.source !== arrival.source) return false;
  if (match.intakeFormId && match.intakeFormId !== arrival.intakeFormId) return false;
  if (match.keyword?.trim()) {
    const haystack = toSearchKey(`${arrival.title} ${arrival.description ?? ""}`);
    const alternatives = match.keyword.split(",").map((alternative) => toSearchKey(alternative).split(" ").filter(Boolean)).filter((words) => words.length > 0);
    if (alternatives.length > 0 && !alternatives.some((words) => words.every((word) => haystack.includes(word)))) return false;
  }
  return true;
}

/**
 * What the arrival gets: rules in their order; for each of assignee, project and priority the
 * first matching rule that sets it wins, labels add up. `ruleIds` are the rules that applied.
 */
export function matchTriageRules(rules: readonly TriageRuleDef[], arrival: TriageArrival): { set: TriageSetDef; ruleIds: string[] } {
  const set: TriageSetDef = {};
  const labels: string[] = [];
  const ruleIds: string[] = [];
  const ordered = [...rules].filter((rule) => rule.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    if (!ruleMatches(rule.match, arrival)) continue;
    const before = JSON.stringify([set, labels]);
    set.assigneePersonId ||= rule.set.assigneePersonId;
    set.projectId ||= rule.set.projectId;
    set.priority ||= rule.set.priority;
    labels.push(...(rule.set.labelIds ?? []).filter((id) => !labels.includes(id)));
    if (JSON.stringify([set, labels]) !== before) ruleIds.push(rule.id);
  }
  if (labels.length) set.labelIds = labels;
  return { set: Object.fromEntries(Object.entries(set).filter(([, value]) => value !== undefined)) as TriageSetDef, ruleIds };
}
