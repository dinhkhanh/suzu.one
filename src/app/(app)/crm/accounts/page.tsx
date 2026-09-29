import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  const [t, f, accounts, entities, people] = await Promise.all([getTranslations("crm"), formatters(), listAccounts(shell.viewer, { q, lifecycle, tier, mine }, todayInVietnam()), listEntities(), listPersonNames()]);
  const activeEntities = entities.filter((entity) => entity.isActive);
  const creatable = activeEntities.filter((entity) => canCreateAccount(shell.viewer, entity.id));
  const canCreate = creatable.length > 0 || canCreateAccount(shell.viewer, null);
  const showMoney = accounts.some((row) => row.seesMoney);
  const showReceivables = accounts.some((row) => row.seesReceivables);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <h1>{t("accounts.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("accounts.intro")}</p>
      </header>
      <CrmTabs current="accounts" show={shell.show} />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder={t("accounts.search")} aria-label={t("accounts.search")} className="w-56" />
        <Select name="lifecycle" defaultValue={lifecycle} aria-label={t("account.fields.lifecycle")}>
          <option value="all">{t("accounts.anyLifecycle")}</option>
          {LIFECYCLES.map((value) => (
            <option key={value} value={value}>
              {t(`enums.lifecycle.${value}`)}
            </option>
          ))}
        </Select>
        <Select name="tier" defaultValue={tier} aria-label={t("account.fields.tier")}>
          <option value="all">{t("accounts.anyTier")}</option>
          {ACCOUNT_TIERS.map((value) => (
            <option key={value} value={value}>
              {t(`enums.tier.${value}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> {t("accounts.mine")}
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("accounts.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accounts.columns.account")}</TableHead>
              <TableHead>{t("accounts.columns.lifecycle")}</TableHead>
              <TableHead>{t("accounts.columns.manager")}</TableHead>
              <TableHead className="text-right">{t("accounts.columns.projects")}</TableHead>
              <TableHead className="text-right">{t("accounts.columns.deals")}</TableHead>
              {showMoney ? <TableHead className="text-right">{t("accounts.columns.pipeline")}</TableHead> : null}
              {showReceivables ? <TableHead className="text-right">{t("accounts.columns.overdue")}</TableHead> : null}
              <TableHead>{t("accounts.columns.lastActivity")}</TableHead>
              <TableHead>{t("accounts.columns.nextFollowUp")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((row) => (
              <TableRow key={row.client.id}>
                <TableCell>
                  <Link href={`/crm/accounts/${row.client.id}`} className="font-medium hover:underline">
                    {row.client.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.client.code}</span>
                  {row.profile?.tier ? <Badge variant="outline" className="ml-2">{t(`enums.tier.${row.profile.tier as "a"}`)}</Badge> : null}
                  {row.profile?.creditHold ? <Badge variant="destructive" className="ml-2">{t("account.creditHold")}</Badge> : null}
                  {row.brands.length ? <p className="text-xs text-muted-foreground">{row.brands.map((brand) => brand.name).join(", ")}</p> : null}
                </TableCell>
                <TableCell>
                  <Badge dot variant={LIFECYCLE_TONE[row.profile?.lifecycle ?? "prospect"]}>
                    {t(`enums.lifecycle.${(row.profile?.lifecycle ?? "prospect") as Lifecycle}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{row.managerName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.signals.openProjects}</TableCell>
                <TableCell className="text-right tabular-nums">{row.signals.openDeals}</TableCell>
                {showMoney ? <TableCell className="text-right tabular-nums">{row.seesMoney ? f.money(row.signals.pipelineVnd) : "—"}</TableCell> : null}
                {showReceivables ? <TableCell className={`text-right tabular-nums ${row.signals.overdueVnd > 0 ? "text-destructive" : ""}`}>{row.seesReceivables ? f.money(row.signals.overdueVnd) : "—"}</TableCell> : null}
                <TableCell className="text-sm">{f.date(row.signals.lastActivityOn)}</TableCell>
                <TableCell className="text-sm">{f.date(row.signals.nextFollowUpOn)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canCreate ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("accounts.new")}</summary>
          <div className="pt-3">
            <NewAccountForm entities={(creatable.length ? creatable : activeEntities).map((entity) => ({ id: entity.id, name: entity.shortName }))} people={people} defaultEntityId={creatable[0]?.id ?? user.person.primaryEntityId} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
