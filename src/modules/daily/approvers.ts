// The approver of last resort (FR-PJM-25): a week is approved by a lead of the person's teams or
// by their line manager, and some people have neither — the head of a branch of the company who
// leads their own team, someone whose manager has left. Their submitted week would wait for ever.
// So where those two rules find nobody who can answer, the week goes to whoever holds
// `work:manage` over the person, and when nobody does, to the owners — the fallback the approval
// engine has for a step that names nobody. Never to the person themself.
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { loadDirectory } from "@/modules/performance/service";
import { can } from "@/modules/platform/rbac/policy";
import { listOwnerPersonIds, listPeopleHoldingEach, loadGrants } from "@/modules/platform/rbac/service";

const FALLBACK_PERMISSION = "work:manage";

/**
 * For each of these people whom the lead and line-manager rules leave with nobody: who approves
 * their week instead. People with a lead or a line manager who can answer are not in the map. A
 * fixed number of queries however many people are asked about, and none at all beyond the
 * directory while every one of them has an active line manager.
 */
export async function fallbackApproversOf(personIds: readonly string[]): Promise<Map<string, string[]>> {
  const directory = await loadDirectory();
  const active = (personId: string | null | undefined) => !!personId && directory.get(personId)?.status === "active";
  const unmanaged = [...new Set(personIds)].filter((personId) => directory.has(personId) && !active(directory.get(personId)!.chainAbove[0]));
  if (unmanaged.length === 0) return new Map();
  // Who among them has a lead after all: an active lead, other than themself, of an active team of theirs.
  const member = alias(schema.workTeamMember, "member");
  const lead = alias(schema.workTeamMember, "lead");
  const led = await db()
    .selectDistinct({ personId: member.personId })
    .from(member)
    .innerJoin(schema.workTeam, and(eq(schema.workTeam.id, member.teamId), eq(schema.workTeam.isActive, true)))
    .innerJoin(lead, and(eq(lead.teamId, member.teamId), eq(lead.role, "lead"), ne(lead.personId, member.personId)))
    .innerJoin(schema.person, and(eq(schema.person.id, lead.personId), eq(schema.person.status, "active")))
    .where(inArray(member.personId, unmanaged));
  const hasLead = new Set(led.map((row) => row.personId));
  const alone = unmanaged.filter((personId) => !hasLead.has(personId));
  if (alone.length === 0) return new Map();
  // The people whose job the work is first — the owners' "*" is left out of this pass, as in the
  // approval engine — and the owners only for someone nobody else is placed over.
  const targets = alone.map((personId) => {
    const person = directory.get(personId)!;
    return { personId, managerId: person.managerId, entityId: person.entityId, unitPath: person.unitPath };
  });
  const [holders, owners] = await Promise.all([listPeopleHoldingEach(FALLBACK_PERMISSION, targets, { includeWildcard: false }), listOwnerPersonIds()]);
  const result = new Map<string, string[]>();
  alone.forEach((personId, index) => {
    const usable = (ids: readonly string[]) => [...new Set(ids)].filter((id) => id !== personId && active(id));
    const named = usable(holders[index]);
    result.set(personId, named.length > 0 ? named : usable(owners));
  });
  return result;
}

/**
 * The people whose weeks this person approves as the approver of last resort — the list form of
 * `fallbackApproversOf`, for the approver's own list of weeks. Only someone holding `work:manage`
 * somewhere (an owner's "*" included) can be anybody's fallback: everyone else is answered from
 * their cached grants, with no query at all.
 */
export async function listFallbackSubjects(approverPersonId: string): Promise<string[]> {
  if (!can({ personId: approverPersonId, workforceType: null, grants: await loadGrants(approverPersonId) }, FALLBACK_PERMISSION)) return [];
  const directory = await loadDirectory();
  const present = [...directory.values()].filter((person) => person.status !== "offboarded").map((person) => person.personId);
  const fallbacks = await fallbackApproversOf(present);
  return [...fallbacks].filter(([, approvers]) => approvers.includes(approverPersonId)).map(([personId]) => personId);
}
