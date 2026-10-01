import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { ACCOUNT_TIERS, canCreateAccount, LIFECYCLES, type Lifecycle, listAccounts } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { NewAccountForm } from "@/modules/crm/ui/account-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmAccounts");

const LIFECYCLE_TONE: Record<string, "success" | "info" | "warning" | "outline" | "secondary"> = { active: "success", prospect: "info", dormant: "warning", churned: "secondary" };

export default async function AccountsPage({ searchParams }: PageProps<"/crm/accounts">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.opens) notFound();
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const q = one(params.q) ?? "";
  const lifecycle = (LIFECYCLES as readonly string[]).includes(one(params.lifecycle) ?? "") ? (one(params.lifecycle) as Lifecycle) : "all";
  const tier = (ACCOUNT_TIERS as readonly string[]).includes(one(params.tier) ?? "") ? (one(params.tier) as "a") : "all";
  const mine = one(params.mine) === "1";
  const today = todayInVietnam();
  const [t, f, accounts, entities, people] = await Promise.all([getTranslations("crm"), formatters(), listAccounts(shell.viewer, { q, lifecycle, tier, mine }, today), listEntities(), listPersonNames()]);
  const activeEntities = entities.filter((entity) => entity.isActive);
  const creatable = activeEntities.filter((entity) => canCreateAccount(shell.viewer, entity.id));
  const canCreate = creatable.length > 0 || canCreateAccount(shell.viewer, null);
  const showMoney = accounts.some((row) => row.seesMoney);
  const showReceivables = accounts.some((row) => row.seesReceivables);

  return (
    <Page width="wide">
      <PageHeader title={t("accounts.title")} description={t("accounts.intro")} />
      <CrmTabs current="accounts" show={shell.show} />
      <form method="get" className="toolbar">
        <Input name="q" defaultValue={q} placeholder={t("accounts.search")} aria-label={t("accounts.search")} className="w-full sm:w-56" />
        <Select name="lifecycle" defaultValue={lifecycle} aria-label={t("account.fields.lifecycle")} className="w-full sm:w-44">
          <option value="all">{t("accounts.anyLifecycle")}</option>
          {LIFECYCLES.map((value) => (
            <option key={value} value={value}>
              {t(`enums.lifecycle.${value}`)}
            </option>
          ))}
        </Select>
        <Select name="tier" defaultValue={tier} aria-label={t("account.fields.tier")} className="w-full sm:w-40">
          <option value="all">{t("accounts.anyTier")}</option>
          {ACCOUNT_TIERS.map((value) => (
            <option key={value} value={value}>
              {t(`enums.tier.${value}`)}
            </option>
          ))}
        </Select>
        <Label className="flex h-10 items-center gap-2 text-sm md:h-9">
          <Checkbox name="mine" value="1" defaultChecked={mine} /> {t("accounts.mine")}
        </Label>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("accounts.columns.account")}</TableHead>
              <TableHead kind="status">{t("accounts.columns.lifecycle")}</TableHead>
              <TableHead kind="person">{t("accounts.columns.manager")}</TableHead>
              <TableHead kind="number">{t("accounts.columns.projects")}</TableHead>
              <TableHead kind="number">{t("accounts.columns.deals")}</TableHead>
              {showMoney ? <TableHead kind="money">{t("accounts.columns.pipeline")}</TableHead> : null}
              {showReceivables ? <TableHead kind="money">{t("accounts.columns.overdue")}</TableHead> : null}
              <TableHead kind="date">{t("accounts.columns.lastActivity")}</TableHead>
              <TableHead kind="date">{t("accounts.columns.nextFollowUp")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? <TableEmpty>{t("accounts.empty")}</TableEmpty> : null}
            {accounts.map((row) => (
              <TableRow key={row.client.id}>
                <TableCell>
                  <Link href={`/crm/accounts/${row.client.id}`} className="font-medium hover:underline">
                    {row.client.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-faint">{row.client.code}</span>
                  {row.profile?.tier ? <Badge variant="outline" className="ml-2">{t(`enums.tier.${row.profile.tier as "a"}`)}</Badge> : null}
                  {row.profile?.creditHold ? <Badge variant="destructive" className="ml-2">{t("account.creditHold")}</Badge> : null}
                  {row.brands.length ? <p className="text-xs text-faint">{row.brands.map((brand) => brand.name).join(", ")}</p> : null}
                </TableCell>
                <TableCell>
                  <Badge dot variant={LIFECYCLE_TONE[row.profile?.lifecycle ?? "prospect"]}>
                    {t(`enums.lifecycle.${(row.profile?.lifecycle ?? "prospect") as Lifecycle}`)}
                  </Badge>
                </TableCell>
                <TableCell>{row.managerName ?? "—"}</TableCell>
                <TableCell kind="number">{row.signals.openProjects}</TableCell>
                <TableCell kind="number">{row.signals.openDeals}</TableCell>
                {showMoney ? <TableCell kind="money">{row.seesMoney ? f.money(row.signals.pipelineVnd) : "—"}</TableCell> : null}
                {showReceivables ? <TableCell kind="money" className={row.signals.overdueVnd > 0 ? "text-destructive" : undefined}>{row.seesReceivables ? f.money(row.signals.overdueVnd) : "—"}</TableCell> : null}
                <TableCell kind="date">{f.date(row.signals.lastActivityOn)}</TableCell>
                <TableCell kind="date" className={row.signals.nextFollowUpOn && row.signals.nextFollowUpOn < today ? "text-destructive" : undefined}>{f.date(row.signals.nextFollowUpOn)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canCreate ? (
          <TableAddRow label={t("accounts.new")}>
            <NewAccountForm entities={(creatable.length ? creatable : activeEntities).map((entity) => ({ id: entity.id, name: entity.shortName }))} people={people} defaultEntityId={creatable[0]?.id ?? user.person.primaryEntityId} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
