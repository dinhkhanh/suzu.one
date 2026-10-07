// The three facts about an asker that decide which tools they are offered beside their roles: do
// they lead a team or a project (a lead's board, workload, timesheets), does anybody report to them
// (a manager's view of a person), and do they work client accounts — own a deal or manage an
// account (the pipeline and receivables, FR-CRM-52). Read once per turn, from what the app already
// holds: the work module's viewer (cached per person), the performance module's directory (cached
// reference) and the CRM's viewer (its account ties, cached per person). The sales tools ask the
// CRM's own gates again when they run.
import "server-only";
import { loadCrm } from "@/modules/crm/service";
import { loadDirectory } from "@/modules/performance/service";
import { loadViewer } from "@/modules/work/service";
import type { AgentUser, AskerFacts } from "./registry";

export async function askerFactsOf(user: AgentUser): Promise<AskerFacts> {
  const [viewer, directory, crm] = await Promise.all([loadViewer(user), loadDirectory(), loadCrm(user)]);
  const leadsWork = [...viewer.teamRoles.values()].some((role) => role === "lead") || [...viewer.projectRoles.values()].some((role) => role === "lead" || role === "account_manager");
  const managesPeople = [...directory.values()].some((person) => person.chainAbove.includes(user.person.id));
  const worksAccounts = [...crm.viewer.ties.values()].some((ties) => ties.some((tie) => tie === "manager" || tie === "sales_owner" || tie === "deal_owner"));
  return { leadsWork, managesPeople, worksAccounts };
}
