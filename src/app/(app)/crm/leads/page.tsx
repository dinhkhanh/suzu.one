import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <Page width="wide">
      <PageHeader title={t("leads.title")} description={t("leads.intro")} />
      <CrmTabs current="leads" show={shell.show} />
      <form method="get" className="toolbar">
        <Select name="status" defaultValue={status} aria-label={t("leads.status")} className="w-full sm:w-48">
          <option value="open">{t("leads.openOnes")}</option>
          <option value="all">{t("leads.allOnes")}</option>
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`enums.leadStatus.${value}`)}
            </option>
          ))}
        </Select>
        <Label className="flex h-10 items-center gap-2 text-sm md:h-9">
          <Checkbox name="mine" value="1" defaultChecked={mine} /> {t("leads.mine")}
        </Label>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("lead.fields.companyName")}</TableHead>
              <TableHead kind="status">{t("leads.status")}</TableHead>
              <TableHead kind="select">{t("lead.fields.source")}</TableHead>
              <TableHead kind="text">{t("lead.fields.need")}</TableHead>
              <TableHead kind="person">{t("lead.fields.owner")}</TableHead>
              <TableHead kind="date">{t("leads.columns.createdAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 ? <TableEmpty>{t("leads.empty")}</TableEmpty> : null}
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  <RecordLink kind="lead" id={lead.id} className="font-medium">
                    {lead.companyName}
                  </RecordLink>
                </TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(lead.status === "new" ? "pending" : lead.status === "converted" ? "done" : lead.status === "disqualified" ? "cancelled" : "open")}>
                    {t(`enums.leadStatus.${lead.status as LeadStatus}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`enums.source.${lead.source as "referral"}`)}</Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-faint">{lead.need ? noteToPlainText(lead.need) : "—"}</TableCell>
                <TableCell>
                  {lead.ownerName ? <RecordLink kind="person" id={lead.ownerPersonId}>{lead.ownerName}</RecordLink> : t("leads.unassigned")}
                  {lead.referrerName ? <p className="text-xs text-faint">{t.rich("leads.referredBy", { name: lead.referrerName, person: (chunks) => <RecordLink kind="person" id={lead.referrerPersonId}>{chunks}</RecordLink> })}</p> : null}
                </TableCell>
                <TableCell kind="date" className="text-muted-foreground">{f.when(lead.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("leads.new")} open={leads.length === 0}>
          <NewLeadForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} accounts={accounts} sellers={people} canAssign={sells(shell.viewer)} />
        </TableAddRow>
      </TableCard>
    </Page>
  );
}
