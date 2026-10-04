import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "cn";
import type { ProjectStatus, StateCategory } from "../enums";
import { StateDot } from "./task-row";

// A task's state and a project's status as tinted pills, one colour per category, so a column of
// them reads at a glance. Every category has its own look: the generic `statusTone()` gives
// "active" and "done" the same green, which on a project list says nothing.

const STATE_TONE: Record<StateCategory, BadgeVariant> = {
  backlog: "outline",
  todo: "secondary",
  in_progress: "info",
  in_review: "violet",
  done: "success",
  cancelled: "outline",
};

/** A workflow state as a pill in its category's tint, led by the row's state dot. */
export function StateBadge({ category, name, className }: { category: string; name: string; className?: string }) {
  const known = (category in STATE_TONE ? category : "todo") as StateCategory;
  return (
    <Badge variant={STATE_TONE[known]} className={cn("max-w-full pl-1.5", className)} title={name}>
      <StateDot category={known} className="size-2" />
      <span className={cn("truncate", known === "cancelled" && "line-through")}>{name}</span>
    </Badge>
  );
}

/** The column of a board: a faint wash of its state's tint, its edge a little stronger. */
export const STATE_COLUMN: Record<StateCategory, string> = {
  backlog: "bg-canvas",
  todo: "bg-canvas",
  in_progress: "border-info/25 bg-info/[0.05]",
  in_review: "border-tone-violet/25 bg-tone-violet/[0.05]",
  done: "border-success/25 bg-success/[0.05]",
  cancelled: "bg-canvas",
};
export const stateColumnClass = (category: string): string => STATE_COLUMN[(category in STATE_COLUMN ? category : "todo") as StateCategory];

const PROJECT_TONE: Record<ProjectStatus, BadgeVariant> = {
  planned: "violet",
  active: "info",
  paused: "warning",
  done: "success",
  archived: "secondary",
};

/** A project's status (its own name from the team's set, else the category's) in its category's tint. */
export function ProjectStatusBadge({ status, name, className }: { status: string; name: string; className?: string }) {
  return (
    <Badge dot variant={PROJECT_TONE[status as ProjectStatus] ?? "outline"} className={className}>
      {name}
    </Badge>
  );
}
