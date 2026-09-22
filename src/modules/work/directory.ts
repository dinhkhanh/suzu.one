// The work directory: every team and project, metadata only. The policy decides visibility from
// these rows on nearly every work screen (which projects and backlogs may this viewer open?), so
// they are read once per request and kept in the shared cache (src/lib/cache). Access is still
// decided per request: the entry holds the whole table and each caller filters it for its viewer.
//
// A team's `task_seq` is left out — it changes with every new task. Every write to `work_team` or
// `work_project` calls `invalidateWorkDirectory()` once committed; the TTL bounds anything written
// behind the app's back (a seed).
import "server-only";
import { asc, getTableColumns } from "drizzle-orm";
import { cache } from "react";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import type { ProjectRow } from "./projects";
import type { TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type DirectoryTeam = Omit<TeamRow, "taskSeq">;
export type WorkDirectory = { teams: DirectoryTeam[]; projects: ProjectRow[] };

const DIRECTORY_KEY = "work:directory";
const DIRECTORY_TTL = 10 * 60;

type TeamColumns = ReturnType<typeof getTableColumns<typeof schema.workTeam>>;
const teamColumns = Object.fromEntries(Object.entries(getTableColumns(schema.workTeam)).filter(([key]) => key !== "taskSeq")) as Omit<TeamColumns, "taskSeq">;

async function loadDirectory(executor: Executor): Promise<WorkDirectory> {
  const [teams, projects] = await Promise.all([executor.select(teamColumns).from(schema.workTeam).orderBy(asc(schema.workTeam.name)), executor.select().from(schema.workProject).orderBy(asc(schema.workProject.name))]);
  return { teams, projects };
}

const cachedDirectory = cache((): Promise<WorkDirectory> => cached(DIRECTORY_KEY, DIRECTORY_TTL, () => loadDirectory(db())));

/** Teams and projects, each ordered by name. Inside a transaction pass it, and the rows come from there. */
export function workDirectory(executor?: Executor): Promise<WorkDirectory> {
  return executor ? loadDirectory(executor) : cachedDirectory();
}

/** Call after a change to `work_team` or `work_project` is committed. */
export const invalidateWorkDirectory = () => invalidate(DIRECTORY_KEY);

/** The projects with their team, as the policy's `projectFacts` wants them. */
export function projectsWithTeams(directory: WorkDirectory): { project: ProjectRow; team: DirectoryTeam }[] {
  const teams = new Map(directory.teams.map((team) => [team.id, team]));
  return directory.projects.flatMap((project) => {
    const team = teams.get(project.teamId);
    return team ? [{ project, team }] : [];
  });
}
