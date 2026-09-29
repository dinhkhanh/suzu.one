// Client profitability (FR-CRM-33) — `pjm:cost` only, as FR-PJM-63's report it is built on: that
// report computes each project's fee and cost from the time logged and payroll's loaded cost rates
// (per person inside it, never out of it) and audits the read; this groups its project lines by
// account and keeps the pitch projects' cost apart as the cost of sale. Private projects the reader
// may not open stay one unnamed line, as there.
import "server-only";
import { readPlans } from "@/modules/projects/service";
import { getProfitability, type ProfitabilityFilter, type ProfitabilityReader } from "@/modules/reports/service";
import { accountsById } from "./accounts";
import { type AccountProfit, accountProfitability } from "./engine/profit";

export type ClientProfitability = { period: { from: string; to: string }; accounts: AccountProfit[]; total: ReturnType<typeof accountProfitability>["total"]; privateLine: { costVnd: number; feeVnd: number | null; projects: number } | null };

export async function getClientProfitability(reader: ProfitabilityReader, filter: Omit<ProfitabilityFilter, "clientId">): Promise<ClientProfitability | null> {
  const view = await getProfitability(reader, filter);
  if (!view) return null;
  const [plans, accounts] = await Promise.all([readPlans(view.projects.map((project) => project.id)), accountsById()]);
  const { accounts: rows, total } = accountProfitability(
    view.projects.map((project) => {
      const account = project.clientId ? accounts.get(project.clientId) : undefined;
      return { accountId: account?.client.id ?? null, accountName: account?.client.name ?? project.clientName, pitch: plans.get(project.id)?.kind === "pitch", feeVnd: project.feeVnd, costVnd: project.costVnd, hours: project.hours, estimated: project.estimated };
    }),
  );
  return { period: view.period, accounts: rows, total, privateLine: view.privateProjects ? { costVnd: view.privateProjects.costVnd, feeVnd: view.privateProjects.feeVnd, projects: view.privateProjects.projects } : null };
}
