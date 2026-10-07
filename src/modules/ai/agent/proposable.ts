// What a confirmed proposal may execute (FR-AGT-21) — and the ONLY place it is looked up. Each entry
// is a module's own server action, through the lazy door its service.ts keeps for it (the action
// file loads on first use): confirming calls it as the person, so its parse, its `authorize`, its
// approval flow, its notifications, its cache invalidation and its audit run exactly as when the
// person submits the module's own form. Nothing else may be proposed: approving, rejecting or
// deciding anything, payroll steps, roles, permissions, someone else's record, and deleting are not
// here and never will be (FR-AGT-23) — `agent-r4.test.ts` holds the list.
//
// Imported only by `proposal-actions.ts`: the tools that write proposals never reach an action.
import "server-only";
import type { ActionResult } from "@/lib/action";
import { recordHref } from "@/lib/record-routes";
import { submitAttendanceRequestAction } from "@/modules/attendance/service";
import { addToPlanAction, logTimeAction, submitReportAction } from "@/modules/daily/service";
import { submitLeaveAction } from "@/modules/leave/service";
import { postStatusUpdateAction } from "@/modules/projects/service";
import { fileRequestAction } from "@/modules/requests/service";
import { addCommentAction, createTaskAction, raiseBlockerAction, resolveBlockerAction, updateTaskAction } from "@/modules/work/service";

type Input = Record<string, unknown>;
type Proposable = {
  execute: (input: unknown) => Promise<ActionResult<unknown>>;
  /** Where the record it made or changed is, once it ran. */
  after: (input: Input, data: unknown) => string | null;
};

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const idOf = (data: unknown): string | null => (data && typeof data === "object" && "id" in data ? str((data as { id: unknown }).id) : null);
const taskOf = (input: Input) => (str(input.taskId) ? recordHref("task", str(input.taskId)!) : null);

export const PROPOSABLE: Readonly<Record<string, Proposable>> = {
  "work.task.create": { execute: createTaskAction, after: (_input, data) => (idOf(data) ? recordHref("task", idOf(data)!) : null) },
  "work.task.update": { execute: updateTaskAction, after: taskOf },
  "work.comment.add": { execute: addCommentAction, after: taskOf },
  "work.blocker.raise": { execute: raiseBlockerAction, after: taskOf },
  "work.blocker.resolve": { execute: resolveBlockerAction, after: taskOf },
  "daily.time.log": { execute: logTimeAction, after: (input) => taskOf(input) ?? "/daily/time" },
  "daily.plan.add": { execute: addToPlanAction, after: () => "/today" },
  "daily.report.submit": { execute: submitReportAction, after: (input) => `/daily/report?date=${str(input.date) ?? ""}` },
  "leave.request.submit": { execute: submitLeaveAction, after: () => "/leave" },
  "attendance.request.submit": { execute: submitAttendanceRequestAction, after: () => "/attendance" },
  "request.file": { execute: fileRequestAction, after: () => "/requests" },
  "projects.status.post": { execute: postStatusUpdateAction, after: (input) => (str(input.projectId) ? `${recordHref("project", str(input.projectId)!)}/updates` : null) },
};

export const PROPOSABLE_ACTIONS = Object.keys(PROPOSABLE);
