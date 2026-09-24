import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { awaitingAcceptance, canDecideBilling, canManageAcceptance, listAcceptances, listPeriodOptions, listProjectBilling, listStructure, openProject } from "@/modules/projects/service";
import { AcceptanceWaitingList } from "@/modules/projects/ui/acceptance-waiting";
import { AcceptanceButtons, ManualBillingForm, NewAcceptanceForm, SignAcceptanceForm, SignedScanLink } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

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
  const [t, tBilling, format, acceptances, structure, periods, billing, waiting] = await Promise.all([
    getTranslations("projects.acceptance"),
    getTranslations("projects.billing"),
    getFormatter(),
    listAcceptances(project.id),
    listStructure(project.id),
    listPeriodOptions(project.id),
    listProjectBilling(project.id, can.seeFees),
    awaitingAcceptance(project.id),
  ]);
  const manage = canManageAcceptance(viewer, facts);
  const addsBilling = canDecideBilling(user.principal, { entityId: project.entityId });
  const today = todayInVietnam();
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const clientFacing = structure.milestones.filter((milestone) => milestone.isClientFacing).map(({ id, name }) => ({ id, name }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="acceptance" />

      <AcceptanceWaitingList projectId={project.id} waiting={waiting} showLink={false} />

      {manage ? (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <h2 className="text-base font-medium">{t("new")}</h2>
          <NewAcceptanceForm projectId={project.id} milestones={clientFacing} periods={periods.map(({ id, month }) => ({ id, month }))} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("list")}</h2>
        {acceptances.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
        {acceptances.map((acceptance) => (
          <article key={acceptance.id} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{acceptance.code}</span>
              <Badge dot variant={statusTone(acceptance.status)}>{t(`status.${acceptance.status as "draft"}`)}</Badge>
              <span className="text-sm text-muted-foreground">{[t(`scopes.${acceptance.scope as "project"}`), acceptance.targetName].filter(Boolean).join(" — ")}</span>
            </div>
            <p className="text-sm">{t("totals", { promised: acceptance.totals.promised, delivered: acceptance.totals.delivered, accepted: acceptance.totals.accepted })}</p>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-normal">{t("item")}</th>
                    <th className="py-1 pr-2 text-right font-normal">{t("promised")}</th>
                    <th className="py-1 pr-2 text-right font-normal">{t("delivered")}</th>
                    <th className="py-1 text-right font-normal">{t("accepted")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {acceptance.items.map((item) => (
                    <tr key={item.deliverableId}>
                      <td className="py-1.5 pr-2">
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
                      </td>
                      <td className="py-1.5 pr-2 text-right">{item.promised}</td>
                      <td className="py-1.5 pr-2 text-right">{item.delivered}</td>
                      <td className="py-1.5 text-right">{item.accepted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  <SignAcceptanceForm acceptanceId={acceptance.id} today={today} />
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{tBilling("projectItems")}</h2>
        {billing.length === 0 ? <p className="text-sm text-muted-foreground">{tBilling("projectEmpty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {billing.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge dot variant={statusTone(item.status)}>{tBilling(`status.${item.status as "ready"}`)}</Badge>
              <span className="font-medium">{item.description}</span>
              <span className="text-muted-foreground">{tBilling(`sources.${item.source as "manual"}`)}</span>
              {"amountVnd" in item ? <span className="ml-auto font-medium">{money(item.amountVnd)}</span> : null}
              {item.invoiceNumber ? <span className="w-full text-xs text-muted-foreground">{tBilling("invoicedAs", { number: item.invoiceNumber, date: date(item.invoiceDate) })}</span> : null}
              {item.waivedReason ? <span className="w-full text-xs text-muted-foreground">{tBilling("waivedBecause", { reason: item.waivedReason })}</span> : null}
            </li>
          ))}
        </ul>
        {addsBilling ? (
          <details className="rounded-xl border border-dashed p-3">
            <summary className="cursor-pointer text-sm">{tBilling("addManual")}</summary>
            <div className="pt-2">
              <ManualBillingForm projectId={project.id} />
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
