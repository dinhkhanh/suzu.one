// Client profitability, pure (FR-CRM-33): the PJM report's project lines, grouped by account, with
// the cost of pitch projects kept apart as the cost of sale. Revenue is the projects' fees on the
// report's own basis (invoiced first); a pitch earns nothing, so its cost is what winning cost.

export type ProfitLine = { accountId: string | null; accountName: string | null; pitch: boolean; feeVnd: number | null; costVnd: number; hours: number; estimated: boolean };
export type AccountProfit = {
  accountId: string | null;
  accountName: string | null;
  projects: number;
  pitches: number;
  revenueVnd: number;
  deliveryCostVnd: number;
  costOfSaleVnd: number;
  marginVnd: number;
  marginRate: number | null;
  hours: number;
  estimated: boolean;
};

export function accountProfitability(lines: readonly ProfitLine[]): { accounts: AccountProfit[]; total: Omit<AccountProfit, "accountId" | "accountName"> } {
  const groups = new Map<string, AccountProfit>();
  for (const line of lines) {
    const key = line.accountId ?? "";
    const row = groups.get(key) ?? { accountId: line.accountId, accountName: line.accountName, projects: 0, pitches: 0, revenueVnd: 0, deliveryCostVnd: 0, costOfSaleVnd: 0, marginVnd: 0, marginRate: null, hours: 0, estimated: false };
    if (line.pitch) {
      row.pitches += 1;
      row.costOfSaleVnd += line.costVnd;
    } else {
      row.projects += 1;
      row.revenueVnd += line.feeVnd ?? 0;
      row.deliveryCostVnd += line.costVnd;
    }
    row.hours += line.hours;
    row.estimated ||= line.estimated;
    groups.set(key, row);
  }
  const accounts = [...groups.values()].map((row) => {
    const marginVnd = row.revenueVnd - row.deliveryCostVnd - row.costOfSaleVnd;
    return { ...row, marginVnd, marginRate: row.revenueVnd ? marginVnd / row.revenueVnd : null, hours: Math.round(row.hours * 10) / 10 };
  });
  const sum = (pick: (row: AccountProfit) => number) => accounts.reduce((total, row) => total + pick(row), 0);
  const revenueVnd = sum((row) => row.revenueVnd);
  const marginVnd = sum((row) => row.marginVnd);
  return {
    accounts: accounts.sort((a, b) => b.marginVnd - a.marginVnd || (a.accountName ?? "").localeCompare(b.accountName ?? "")),
    total: {
      projects: sum((row) => row.projects),
      pitches: sum((row) => row.pitches),
      revenueVnd,
      deliveryCostVnd: sum((row) => row.deliveryCostVnd),
      costOfSaleVnd: sum((row) => row.costOfSaleVnd),
      marginVnd,
      marginRate: revenueVnd ? marginVnd / revenueVnd : null,
      hours: Math.round(sum((row) => row.hours) * 10) / 10,
      estimated: accounts.some((row) => row.estimated),
    },
  };
}
