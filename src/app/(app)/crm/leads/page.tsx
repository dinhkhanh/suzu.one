import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { statusTone } from "@/components/ui/tone";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { accountChoices, LEAD_STATUSES, type LeadStatus, listLeads } from "@/modules/crm/service";
import { crmShell, sells } from "@/modules/crm/pages";
import { NewLeadForm } from "@/modules/crm/ui/deal-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";

export const generateMetadata = pageTitle("crmLeads");

export default async function LeadsPage({ searchParams }: PageProps<"/crm/leads">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.leads) notFound();
  const params = await searchParams;
  const raw = typeof params.status === "string" ? params.status : "open";
  const status = raw === "all" || raw === "open" || (LEAD_STATUSES as readonly string[]).includes(raw) ? (raw as LeadStatus | "open" | "all") : "open";
  const mine = params.mine === "1";
  const [t, f, leads, entities, accounts, people] = await Promise.all([getTranslations("crm"), formatters(), listLeads(shell.viewer, { status, mine }), listEntities(), accountChoices(shell.viewer), listPersonNames()]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("leads.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("leads.intro")}</p>
      </header>
      <CrmTabs current="leads" show={shell.show} />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <Select name="status" defaultValue={status} aria-label={t("leads.status")}>
          <option value="open">{t("leads.openOnes")}</option>
          <option value="all">{t("leads.allOnes")}</option>
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`enums.leadStatus.${value}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> {t("leads.mine")}
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>
      {leads.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("leads.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {leads.map((lead) => (
            <li key={lead.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Link href={`/crm/leads/${lead.id}`} className="font-medium hover:underline">
                {lead.companyName}
              </Link>
              <Badge dot variant={statusTone(lead.status === "new" ? "pending" : lead.status === "converted" ? "done" : lead.status === "disqualified" ? "cancelled" : "open")}>
                {t(`enums.leadStatus.${lead.status as LeadStatus}`)}
              </Badge>
              <span className="text-xs text-muted-foreground">{t(`enums.source.${lead.source as "referral"}`)}</span>
              {lead.need ? <span className="max-w-md truncate text-xs text-muted-foreground">{noteToPlainText(lead.need)}</span> : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {lead.ownerName ?? t("leads.unassigned")}
                {lead.referrerName ? ` · ${t("leads.referredBy", { name: lead.referrerName })}` : ""} · {f.when(lead.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-xl border p-4" open={leads.length === 0}>
        <summary className="cursor-pointer text-sm font-medium">{t("leads.new")}</summary>
        <div className="pt-3">
          <NewLeadForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} accounts={accounts} sellers={people} canAssign={sells(shell.viewer)} />
        </div>
      </details>
    </div>
  );
}
