import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { accountsById, canSeeAccountMoney, canViewContracts, listContracts } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmContracts");

export default async function ContractsPage({ searchParams }: PageProps<"/crm/contracts">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.contracts) notFound();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "live";
  const today = todayInVietnam();
  const [t, f, accounts] = await Promise.all([getTranslations("crm"), formatters(), accountsById()]);
  // The accounts whose contracts this reader may see; the value only where account money is theirs to read.
  const visible = [...new Set([...accounts.values()].filter((account) => canViewContracts(shell.viewer, account.facts)).map((account) => account.client.id))];
  const contracts = (await listContracts(visible, (row) => { const account = accounts.get(row.clientId); return !!account && canSeeAccountMoney(shell.viewer, account.facts); }, today)).filter((contract) => state === "all" || (state === "live" ? contract.state === "active" || contract.state === "upcoming" || contract.state === "draft" : contract.state === state));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <h1>{t("contracts.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("contracts.intro")}</p>
      </header>
      <CrmTabs current="contracts" show={shell.show} />
      <nav className="flex flex-wrap gap-2 text-sm">
        {(["live", "active", "draft", "expired", "terminated", "all"] as const).map((value) => (
          <Link key={value} href={`/crm/contracts?state=${value}`} aria-current={value === state ? "page" : undefined} className={`rounded-md border px-3 py-1 ${value === state ? "pill-on" : "pill-off"}`}>
            {t(`contracts.states.${value}`)}
          </Link>
        ))}
      </nav>
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("contracts.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("contracts.columns.number")}</TableHead>
              <TableHead>{t("contracts.columns.account")}</TableHead>
              <TableHead>{t("contracts.columns.kind")}</TableHead>
              <TableHead>{t("contracts.columns.state")}</TableHead>
              <TableHead>{t("contracts.columns.period")}</TableHead>
              <TableHead className="text-right">{t("contracts.columns.value")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell>
                  <Link href={`/crm/contracts/${contract.id}`} className="font-medium hover:underline">
                    {contract.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">{contract.title}</p>
                </TableCell>
                <TableCell>
                  <Link href={`/crm/accounts/${contract.clientId}`} className="hover:underline">
                    {contract.accountName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{t(`contract.kinds.${contract.kind as "service"}`)}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(contract.state === "upcoming" ? "scheduled" : contract.state)}>
                    {t(`enums.contractState.${contract.state}`)}
                  </Badge>
                  {contract.renewalDealId ? (
                    <Link href={`/crm/deals/${contract.renewalDealId}`} className="ml-2 text-xs underline">
                      {t("contracts.renewal")}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">
                  {f.date(contract.startDate)} – {f.date(contract.endDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{"valueVnd" in contract ? f.money(contract.valueVnd) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
