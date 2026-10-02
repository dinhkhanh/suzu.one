// Workflows for service tests. The app ships none (FR-WRK-03: people keep them in the library);
// these two stand in for what a team would have made. A state's name is its key unless renamed.
import type { StateSetItem } from "@/modules/work/schema";

const WORKFLOWS = {
  simple: [
    ["backlog", "backlog"],
    ["todo", "todo"],
    ["in_progress", "in_progress"],
    ["in_review", "in_review"],
    ["done", "done"],
    ["cancelled", "cancelled"],
  ],
  content: [
    ["backlog", "backlog"],
    ["brief", "todo"],
    ["ideation", "in_progress"],
    ["script", "in_progress"],
    ["design", "in_progress"],
    ["edit", "in_progress"],
    ["internal_review", "in_review"],
    ["client_review", "in_review"],
    ["scheduled", "in_progress"],
    ["published", "done"],
    ["reported", "done"],
    ["cancelled", "cancelled"],
  ],
} as const;

export function workflow(kind: keyof typeof WORKFLOWS, names: Record<string, string> = {}): StateSetItem[] {
  return WORKFLOWS[kind].map(([key, category]) => ({ name: names[key] ?? key, category }));
}
