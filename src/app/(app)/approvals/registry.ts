// The composition root of the approval engine: every request type with its definition and the
// server action of the module that owns it. Platform code cannot import feature modules, and a
// request's effect (apply the change, book the leave) lives with its owner — so the things that
// must know every type (bulk approve, the flow administration) look them up here.
// A new request type is registered here when its module adds it.
//
// Two kinds of type meet here. The ones **in code** are fixed and each has its own effect. The
// ones **in the database** come from the request builder (FR-REQ-01): an administrator invents
// them, they have no effect of their own, and they are resolved at request time — which is why
// everything that needs the whole catalogue goes through `allRequestTypes()` rather than the map.
import "server-only";
import type { ActionResult } from "@/lib/action";
import { decideAttendanceRequestAction } from "@/modules/attendance/request-actions";
import { REQUEST_DEFINITIONS as ATTENDANCE_REQUESTS } from "@/modules/attendance/requests";
import { profileChangeRequest } from "@/modules/core-hr/change-requests";
import { decideProfileChangeAction } from "@/modules/core-hr/change-request-actions";
import { decideResignationAction } from "@/modules/core-hr/lifecycle-actions";
import { resignationRequest } from "@/modules/core-hr/resignation";
import { decidePageReviewAction } from "@/modules/kb/actions";
import { kbPublishRequest } from "@/modules/kb/service";
import { decideLeaveAction } from "@/modules/leave/actions";
import { leaveRequestType } from "@/modules/leave/requests";
import type { RequestTypeDefinition } from "@/modules/platform/approvals/service";
import { decideHiringRequestAction } from "@/modules/recruit/actions";
import { hiringRequestType } from "@/modules/recruit/hiring";
import { decideRequestAction } from "@/modules/requests/actions";
import { registeredGenericTypes } from "@/modules/requests/service";

export type RegisteredRequestType = {
  definition: RequestTypeDefinition;
  /** The owning module's decide action, called with an approval and no comment: parse → authorize → effect → audit, as if the approver had opened the request. */
  approve: (requestId: string) => Promise<ActionResult<unknown>>;
  /** What to call the type on screen when it has no message key — the builder's types carry their own name. */
  names?: { vi: string; en: string };
};

const REGISTERED: RegisteredRequestType[] = [
  { definition: profileChangeRequest, approve: (requestId) => decideProfileChangeAction({ requestId, decision: "approve", comment: null }) },
  { definition: leaveRequestType, approve: (requestId) => decideLeaveAction({ requestId, decision: "approve", comment: null }) },
  ...Object.values(ATTENDANCE_REQUESTS).map((definition) => ({ definition, approve: (requestId: string) => decideAttendanceRequestAction({ requestId, decision: "approve", comment: null }) })),
  { definition: resignationRequest, approve: (requestId) => decideResignationAction({ requestId, decision: "approve", comment: null }) },
  // Never bulk-approvable (a reviewer reads the revision first); registered for the flow administration.
  { definition: kbPublishRequest, approve: (requestId) => decidePageReviewAction({ requestId, decision: "approve", comment: null }) },
  // A head is a budget decision and its budget is not in the summary, so this one is never bulk-
  // approvable either (FR-REC-01); registered so the flow administration can configure it.
  { definition: hiringRequestType, approve: (requestId) => decideHiringRequestAction({ requestId, decision: "approve", comment: null }) },
];

export const REQUEST_TYPES: ReadonlyMap<string, RegisteredRequestType> = new Map(REGISTERED.map((entry) => [entry.definition.type, entry]));

/**
 * Every type there is, in code and in the database. Read once per request that needs it — the
 * builder's types change while the app runs, so nothing here may be cached at module scope.
 */
export async function allRequestTypes(): Promise<ReadonlyMap<string, RegisteredRequestType>> {
  const merged = new Map(REQUEST_TYPES);
  for (const { row, definition } of await registeredGenericTypes()) {
    merged.set(definition.type, { definition, approve: (requestId) => decideRequestAction({ requestId, decision: "approve", comment: null }), names: { vi: row.nameVi, en: row.nameEn } });
  }
  return merged;
}

/** One type, wherever it is defined. */
export async function findRegisteredType(type: string): Promise<RegisteredRequestType | undefined> {
  return REQUEST_TYPES.get(type) ?? (await allRequestTypes()).get(type);
}

/** `request:purchase` → "Đề nghị mua sắm", for the screens that only need a label. */
export async function requestTypeLabels(locale: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  for (const [type, entry] of await allRequestTypes()) if (entry.names) labels.set(type, locale === "en" ? entry.names.en : entry.names.vi);
  return labels;
}
