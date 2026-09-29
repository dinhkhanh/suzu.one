// What the CRM's pages share: the viewer, and which of its tabs this viewer can use — so a tab is
// never offered that would land on a "not found". Each page still checks its own access.
import "server-only";
import { can } from "../platform/rbac/policy";
import { ownsAnyDeal } from "./deals";
import { canConfigureCrm, canLogLead, canOpenCrm, canOpenPipeline, canOpenReceivables, type CrmViewer } from "./policy";
import type { CrmTab } from "./ui/tabs";
import { type CrmContext, loadCrm } from "./viewer";
import type { ViewerSource } from "@/modules/work/service";
import { canDecideCommissionScheme, canProposeCommissionScheme, canRunCommission } from "./commission";

export type CrmShell = CrmContext & { show: Record<CrmTab, boolean>; opens: boolean };

export const sells = (viewer: CrmViewer): boolean => can(viewer.principal, "crm:sell") || can(viewer.principal, "crm:manage");
export const managesAnAccount = (viewer: CrmViewer): boolean => [...viewer.ties.values()].some((ties) => ties.includes("manager"));

export async function crmShell(user: ViewerSource & { person: { id: string } }): Promise<CrmShell> {
  const context = await loadCrm(user);
  const { viewer } = context;
  const opens = canOpenCrm(viewer);
  const pipeline = canOpenPipeline(viewer, await ownsAnyDeal(user.person.id)) || viewer.ties.size > 0;
  return {
    ...context,
    opens,
    show: {
      home: opens,
      accounts: opens,
      leads: canLogLead(viewer),
      deals: pipeline,
      contracts: pipeline,
      invoices: canOpenReceivables(viewer, managesAnAccount(viewer)),
      reports: pipeline || can(viewer.principal, "pjm:cost"),
      // Compensation: the sellers' own statements, C&B, and whoever proposes or decides the scheme.
      commission: sells(viewer) || managesAnAccount(viewer) || canRunCommission(viewer.principal) || canProposeCommissionScheme(viewer.principal) || canDecideCommissionScheme(viewer.principal),
      rateCard: sells(viewer),
      settings: canConfigureCrm(viewer),
    },
  };
}
