import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { accountsById, canSeeAccountMoney, canViewContracts, listContracts } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmContracts");

const STATES = ["live", "active", "draft", "expired", "terminated", "all"] as const;

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
    <Page width="wide">
      <PageHeader title={t("contracts.title")} description={t("contracts.intro")} />
      <CrmTabs current="contracts" show={shell.show} />
      <nav className="tab-row" aria-label={t("contracts.columns.state")}>
        {STATES.map((value) => (
          <Link key={value} href={`/crm/contracts?state=${value}`} aria-current={value === state ? "page" : undefined}>
            {t(`contracts.states.${value}`)}
          </Link>
        ))}
      </nav>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="id">{t("contracts.columns.number")}</TableHead>
            <TableHead kind="org">{t("contracts.columns.account")}</TableHead>
            <TableHead kind="select">{t("contracts.columns.kind")}</TableHead>
            <TableHead kind="status">{t("contracts.columns.state")}</TableHead>
            <TableHead kind="date">{t("contracts.columns.period")}</TableHead>
            <TableHead kind="money">{t("contracts.columns.value")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.length === 0 ? <TableEmpty>{t("contracts.empty")}</TableEmpty> : null}
          {contracts.map((contract) => (
            <TableRow key={contract.id}>
              <TableCell kind="id">
                <RecordLink kind="contract" id={contract.id} className="font-medium text-foreground">
                  {contract.number}
                </RecordLink>
                <p className="font-sans text-xs text-faint">{contract.title}</p>
              </TableCell>
              <TableCell>
                <RecordLink kind="account" id={contract.clientId}>{contract.accountName}</RecordLink>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{t(`contract.kinds.${contract.kind as "service"}`)}</Badge>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Badge dot variant={statusTone(contract.state === "upcoming" ? "scheduled" : contract.state)}>
                    {t(`enums.contractState.${contract.state}`)}
                  </Badge>
                  {contract.renewalDealId ? (
                    <Link href={`/crm/deals/${contract.renewalDealId}`} className="text-xs text-link hover:underline">
                      {t("contracts.renewal")}
                    </Link>
                  ) : null}
                </span>
              </TableCell>
              <TableCell kind="date" className="text-muted-foreground">
                {f.date(contract.startDate)} – {f.date(contract.endDate)}
              </TableCell>
              <TableCell kind="money">{"valueVnd" in contract ? f.money(contract.valueVnd) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
}
