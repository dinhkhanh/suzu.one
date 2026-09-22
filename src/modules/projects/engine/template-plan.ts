// The plan half of a project template (FR-PJM-15) → dated phases, milestones and register lines
// for a new project. Pure. Days count from the same day 0 as the template's steps, and an "end"
// anchor counts back from the last day the template knows, exactly as the task tree does, so a
// milestone and the tasks that lead to it stay side by side.
import { addDays, type IsoDate } from "@/lib/dates";
import type { ProjectBrief, RoleBudget, TemplateLine, TemplateMilestone, TemplatePhase } from "../schema";
import { totalOfRoles } from "./budget";

export type TemplatePlanParts = { phases: readonly TemplatePhase[]; milestones: readonly TemplateMilestone[]; deliverables: readonly TemplateLine[]; budgetByRole: readonly RoleBudget[] };
export type Anchor = { mode: "start" | "end"; date: IsoDate };

export type DatedPlan = {
  phases: { name: string; startDate: IsoDate; endDate: IsoDate; sortOrder: number }[];
  milestones: { name: string; dueDate: IsoDate; phase: number | null; isClientFacing: boolean; isBilling: boolean; sortOrder: number }[];
  lines: { title: string; quantity: number; format: string | null; channel: string | null; milestone: number | null; dueDate: IsoDate | null; sortOrder: number }[];
  budgetMinutes: number | null;
};

/** `lastStepDay`: the latest day among the template's steps, so an "end" anchor lines both halves up. */
export function datePlan(parts: TemplatePlanParts, anchor: Anchor, lastStepDay: number): DatedPlan {
  const days = [lastStepDay, ...parts.phases.flatMap((phase) => [phase.startDay, phase.endDay]), ...parts.milestones.map((milestone) => milestone.day), ...parts.deliverables.flatMap((line) => (line.day === null ? [] : [line.day]))];
  const shift = anchor.mode === "end" ? -Math.max(0, ...days) : 0;
  const on = (day: number) => addDays(anchor.date, day + shift);
  const validIndex = (index: number | null, length: number) => (index !== null && index >= 0 && index < length ? index : null);
  const total = totalOfRoles(parts.budgetByRole);
  return {
    phases: parts.phases.map((phase, index) => ({ name: phase.name, startDate: on(Math.min(phase.startDay, phase.endDay)), endDate: on(Math.max(phase.startDay, phase.endDay)), sortOrder: index })),
    milestones: parts.milestones.map((milestone, index) => ({ name: milestone.name, dueDate: on(milestone.day), phase: validIndex(milestone.phase, parts.phases.length), isClientFacing: milestone.isClientFacing, isBilling: milestone.isBilling, sortOrder: index })),
    lines: parts.deliverables.map((line, index) => ({ title: line.title, quantity: Math.max(1, line.quantity), format: line.format, channel: line.channel, milestone: validIndex(line.milestone, parts.milestones.length), dueDate: line.day === null ? null : on(line.day), sortOrder: index })),
    budgetMinutes: total > 0 ? total : null,
  };
}

/** The brief of a new project: the template's, with its client contacts and links copied, never shared. */
export const briefFromTemplate = (brief: ProjectBrief): ProjectBrief => ({ ...brief, clientContacts: brief.clientContacts?.map((contact) => ({ ...contact })), links: brief.links ? [...brief.links] : undefined });
