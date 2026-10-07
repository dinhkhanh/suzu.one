// The two facts about an asker that decide which tools they are offered beside their roles: do they
// lead a team or a project (a lead's board, workload, timesheets), and does anybody report to them
// (a manager's view of a person). Read once per turn, from what the app already holds: the work
// module's viewer (cached per person) and the performance module's directory (cached reference).
import "server-only";
import { loadDirectory } from "@/modules/performance/service";
import { loadViewer } from "@/modules/work/service";
import type { AgentUser, AskerFacts } from "./registry";

export async function askerFactsOf(user: AgentUser): Promise<AskerFacts> {
  const [viewer, directory] = await Promise.all([loadViewer(user), loadDirectory()]);
  const leadsWork = [...viewer.teamRoles.values()].some((role) => role === "lead") || [...viewer.projectRoles.values()].some((role) => role === "lead" || role === "account_manager");
  const managesPeople = [...directory.values()].some((person) => person.chainAbove.includes(user.person.id));
  return { leadsWork, managesPeople };
}
