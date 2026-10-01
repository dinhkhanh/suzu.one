import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/ui/page";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { awaitingAcceptance, canDecideBilling, canManageAcceptance, listAcceptances, listPeriodOptions, listProjectBilling, listStructure, openProject } from "@/modules/projects/service";
import { AcceptanceWaitingList } from "@/modules/projects/ui/acceptance-waiting";
import { AcceptanceButtons, ManualBillingForm, NewAcceptanceForm, SignAcceptanceForm, SignedScanLink } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";
import { contactChoicesFor } from "@/modules/crm/service";

export const generateMetadata = pageTitle("acceptance");


/**
 * Acceptance — biên bản nghiệm thu (FR-PJM-55) — and what it hands finance (FR-PJM-56): per
 * client-facing milestone, per retainer month or for the whole project; the register snapshot,
 * the generated paper, draft → sent → signed with the scan. The project's billing items below,
 * their amounts only for `pjm:commercial`.
 */
export default async function ProjectAcceptancePage({ params }: PageProps<"/projects/[projectId]/acceptance">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, can, viewer, facts } = context;
  const manage = canManageAcceptance(viewer, facts);
  const [t, tBilling, format, acceptances, structure, periods, billing, waiting, signers] = await Promise.all([
    getTranslations("projects.acceptance"),
    getTranslations("projects.billing"),
    getFormatter(),
    listAcceptances(project.id),
    listStructure(project.id),
    listPeriodOptions(project.id),
    listProjectBilling(project.id, can.seeFees),
    awaitingAcceptance(project.id),
    manage ? contactChoicesFor(project.clientId) : [],
  ]);
  const addsBilling = canDecideBilling(user.principal, { entityId: project.entityId });
  const today = todayInVietnam();
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const clientFacing = structure.milestones.filter((milestone) => milestone.isClientFacing).map(({ id, name }) => ({ id, name }));

  return (
    <Page>
      <ProjectHeader context={context} current="acceptance" />

      <AcceptanceWaitingList projectId={project.id} waiting={waiting} showLink={false} />

      <TableCard>
        <TableCardHeader title={t("list")} count={acceptances.length || null} />
        <List>
          {acceptances.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {acceptances.map((acceptance) => (
            <ListItem key={acceptance.id} className="flex-col items-stretch gap-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{acceptance.code}</span>
                <Badge dot variant={statusTone(acceptance.status)}>{t(`status.${acceptance.status as "draft"}`)}</Badge>
                <span className="text-sm text-muted-foreground">{[t(`scopes.${acceptance.scope as "project"}`), acceptance.targetName].filter(Boolean).join(" — ")}</span>
              </div>
              <p className="text-sm">{t("totals", { promised: acceptance.totals.promised, delivered: acceptance.totals.delivered, accepted: acceptance.totals.accepted })}</p>
              <Table numbered={false} className="min-w-[30rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead kind="text">{t("item")}</TableHead>
                    <TableHead kind="number">{t("promised")}</TableHead>
                    <TableHead kind="number">{t("delivered")}</TableHead>
                    <TableHead kind="number">{t("accepted")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acceptance.items.map((item) => (
                    <TableRow key={item.deliverableId}>
                      <TableCell className="whitespace-normal">
                        {item.title}
                        {item.links.length ? (
                          <span className="block text-xs">
                            {item.links.map((link) => (
                              <a key={link} href={link} target="_blank" rel="noreferrer" className="mr-2 break-all text-muted-foreground underline">
                                {link}
                              </a>
                            ))}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell kind="number">{item.promised}</TableCell>
                      <TableCell kind="number">{item.delivered}</TableCell>
                      <TableCell kind="number">{item.accepted}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {acceptance.status !== "void" ? (
                  <a href={`/projects/${project.id}/acceptance/${acceptance.id}/pdf`} className="underline">
                    {t("pdf")}
                  </a>
                ) : null}
                {acceptance.status === "signed" ? (
                  <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    {t("signedInfo", { name: acceptance.signedByClient ?? "—", date: date(acceptance.signedOn) })}
                    <SignedScanLink acceptanceId={acceptance.id} label={t("signedScan")} />
                  </span>
                ) : null}
                {manage ? <AcceptanceButtons acceptanceId={acceptance.id} status={acceptance.status} /> : null}
              </div>
              {manage && (acceptance.status === "draft" || acceptance.status === "sent") ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">{t("recordSignature")}</summary>
                  <div className="pt-2">
                    <SignAcceptanceForm acceptanceId={acceptance.id} today={today} contacts={signers} />
                  </div>
                </details>
              ) : null}
            </ListItem>
          ))}
        </List>
        {manage ? (
          <TableAddRow label={t("new")} open={acceptances.length === 0}>
            <NewAcceptanceForm projectId={project.id} milestones={clientFacing} periods={periods.map(({ id, month }) => ({ id, month }))} />
          </TableAddRow>
        ) : null}
      </TableCard>

      <TableCard>
        <TableCardHeader title={tBilling("projectItems")} count={billing.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{tBilling("description")}</TableHead>
              <TableHead kind="status">{tBilling("statusFilter")}</TableHead>
              <TableHead kind="select">{tBilling("source")}</TableHead>
              {can.seeFees ? <TableHead kind="money">{tBilling("amount")}</TableHead> : null}
              <TableHead kind="text">{tBilling("invoice")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billing.length === 0 ? <TableEmpty>{tBilling("projectEmpty")}</TableEmpty> : null}
            {billing.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium whitespace-normal">{item.description}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(item.status)}>{tBilling(`status.${item.status as "ready"}`)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{tBilling(`sources.${item.source as "manual"}`)}</Badge>
                </TableCell>
                {can.seeFees ? <TableCell kind="money">{"amountVnd" in item ? money(item.amountVnd) : "—"}</TableCell> : null}
                <TableCell className="text-xs text-muted-foreground">{[item.invoiceNumber ? tBilling("invoicedAs", { number: item.invoiceNumber, date: date(item.invoiceDate) }) : null, item.waivedReason ? tBilling("waivedBecause", { reason: item.waivedReason }) : null].filter(Boolean).join(" · ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {addsBilling ? (
          <TableAddRow label={tBilling("addManual")}>
            <ManualBillingForm projectId={project.id} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
