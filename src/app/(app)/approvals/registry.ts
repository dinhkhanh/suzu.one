// The composition root of the approval engine: every request type with its definition and the
// server action of the module that owns it. Platform code cannot import feature modules, and a
// request's effect (apply the change, book the leave) lives with its owner — so the things that
// must know every type (bulk approve, the flow administration) look them up here.
// A new request type is registered here when its module adds it.
import "server-only";
import type { ActionResult } from "@/lib/action";
import { profileChangeRequest } from "@/modules/core-hr/change-requests";
import { decideProfileChangeAction } from "@/modules/core-hr/change-request-actions";
import { decideResignationAction } from "@/modules/core-hr/lifecycle-actions";
import { resignationRequest } from "@/modules/core-hr/resignation";
import { decideLeaveAction } from "@/modules/leave/actions";
import { leaveRequestType } from "@/modules/leave/requests";
import type { RequestTypeDefinition } from "@/modules/platform/approvals/service";

export type RegisteredRequestType = {
  definition: RequestTypeDefinition;
  /** The owning module's decide action, called with an approval and no comment: parse → authorize → effect → audit, as if the approver had opened the request. */
  approve: (requestId: string) => Promise<ActionResult<unknown>>;
};

const REGISTERED: RegisteredRequestType[] = [
  { definition: profileChangeRequest, approve: (requestId) => decideProfileChangeAction({ requestId, decision: "approve", comment: null }) },
  { definition: leaveRequestType, approve: (requestId) => decideLeaveAction({ requestId, decision: "approve", comment: null }) },
  { definition: resignationRequest, approve: (requestId) => decideResignationAction({ requestId, decision: "approve", comment: null }) },
];

export const REQUEST_TYPES: ReadonlyMap<string, RegisteredRequestType> = new Map(REGISTERED.map((entry) => [entry.definition.type, entry]));
