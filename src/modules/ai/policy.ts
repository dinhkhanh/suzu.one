// Who may use the assistant, and who may read what it could not answer (FR-AI-06). Pure.
//
// Asking is open to everybody with a person record, collaborators included — not because the
// assistant is harmless, but because it has no rights of its own. Every answer is built from the
// asker's own permission-filtered retrieval, so "may they use it" and "what may they see" are not
// the same question: the second is answered in SQL, per asker, on every single turn. A collaborator
// who is named on no knowledge-base page simply gets "I do not know" to everything.
//
// The unanswered-question log is different: it holds other people's questions, and a question can
// be revealing ("what do I do about my disciplinary hearing"). Decision: it is for whoever keeps
// the knowledge base — `kb:manage` — because the log's only purpose is deciding which page to
// write next, and those are the people who write pages. Not HR at large, not `report:read`.
//
// What the assistant cost — answers and tokens, per day and per person — is the owner's: it is a
// bill, and it names who ran it up. No permission is spent on it: it is read by whoever holds
// everything ("*") over the whole group, which is what the owner role is.
import { can, type Principal } from "../platform/rbac/policy";
import { ROLE_DEFINITIONS } from "../platform/rbac/roles";

/** Anybody signed in. The answer, not the door, is where permissions are enforced. */
export const canAskAssistant = (principal: Principal): boolean => principal.personId !== null;

/** The backlog of questions the knowledge base could not answer: its keepers. */
export const canReadUnansweredLog = (principal: Principal): boolean => can(principal, "kb:manage");

/** The assistant's usage and its tokens: the owner alone. */
export const canReadAssistantUsage = (principal: Principal): boolean => principal.grants.some((grant) => grant.scope.type === "group" && ROLE_DEFINITIONS[grant.role].permissions.includes("*"));

/**
 * Who gets the agent rather than Phase 9's assistant (Phase 13 R1's pilot). Everybody, or — while
 * it is piloted — the owners and the work emails the owner listed. Not a permission: the agent has
 * no rights of its own, so this decides which assistant answers, not what anybody may see.
 */
export function agentAudienceAdmits(principal: Principal, email: string | null | undefined, settings: { audience: "pilot" | "everyone"; pilotEmails: string }): boolean {
  if (principal.personId === null) return false;
  if (settings.audience === "everyone" || canReadAssistantUsage(principal)) return true;
  const wanted = (email ?? "").trim().toLowerCase();
  return wanted.length > 0 && settings.pilotEmails.split(/[\s,;]+/u).some((listed) => listed.trim().toLowerCase() === wanted);
}
