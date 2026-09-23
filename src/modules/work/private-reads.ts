// The trail a private project leaves when a leader who is none of its people reads it (FR-PJM-8;
// the owner's decision of 2026-09-23, Q25 — D30). The decision let `pjm:portfolio` holders open a
// private project; it also said the read is recorded, so this is where every reader path records
// it. The seam sits in the work module, beside `readsPrivateByPortfolio` itself, so that a new
// reader — a list, a search, a panel — records the read by asking the same question it already
// asks about access, instead of remembering to call something in another module.
//
// What is recorded is who looked, which project and on what authority. **Never the project's
// name**: the audit log is read company-wide by `audit:read` holders, and the name of a private
// project is part of what it keeps to itself; the resource id names it for whoever may follow it up.
import "server-only";
import { recordAudit } from "../platform/audit/service";
import { type ProjectFacts, readsPrivateByPortfolio, type WorkViewer } from "./policy";

/**
 * The private projects already recorded for a viewer. `loadViewer` is memoised per request, so
 * every reader path of one request shares one viewer object and one set: a leader whose page opens
 * a private project's board, one of its tasks and its documents leaves one row per project, not one
 * per row read. A viewer built for somebody else (`viewersOfPeople`) keeps its own set, and the map
 * holds viewers weakly, so nothing outlives the request that made them.
 */
const noted = new WeakMap<WorkViewer, Set<string>>();

/**
 * Records that this reader resolved a private project they are none of the people of. Any other
 * project — public, or one of theirs — is a no-op, so a reader path may hand over everything it
 * resolved and let this decide.
 */
export async function notePrivateProjectRead(viewer: WorkViewer, project: ProjectFacts): Promise<void> {
  if (!readsPrivateByPortfolio(viewer, project)) return;
  let seen = noted.get(viewer);
  if (!seen) noted.set(viewer, (seen = new Set()));
  if (seen.has(project.id)) return;
  seen.add(project.id);
  await recordAudit({
    action: "projects.private.read",
    actor: { userId: viewer.reader?.userId ?? null, personId: viewer.principal.personId, email: viewer.reader?.email ?? null },
    request: viewer.reader?.request,
    resource: { type: "work_project", id: project.id, entityId: project.entityId },
    after: { visibility: "private", via: "pjm:portfolio", teamId: project.team.id },
  });
}

/** The same for a reader that resolves several projects at once — a list, a search, a capacity grid. */
export async function notePrivateProjectReads(viewer: WorkViewer, projects: Iterable<ProjectFacts | null | undefined>): Promise<void> {
  for (const project of projects) if (project) await notePrivateProjectRead(viewer, project);
}
