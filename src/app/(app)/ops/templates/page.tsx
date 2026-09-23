import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { canManageLibrary, canReadOps, DEFAULT_ESCALATION, DEFAULT_REMINDER_LEAD_DAYS, listTemplates, NO_EVIDENCE, type ObligationTemplateRow } from "@/modules/ops/service";
import { ReviewButton, TemplateForm, type TemplateFormValue } from "@/modules/ops/ui/library";
import { OpsNav } from "@/modules/ops/ui/overview";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { ROLE_DEFINITIONS, ROLES } from "@/modules/platform/rbac/roles";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("obligationLibrary");

const BLANK: TemplateFormValue = { id: null, code: "", name: "", category: "internal", authority: "internal", recurrence: "monthly", dueRule: { type: "after_period", monthsAfter: 1, day: 20 }, shift: "next_working_day", eventType: null, entityIds: null, ownerRule: "permission:ops:manage", ownerPersonId: null, reviewerRule: "none", reviewerPersonId: null, checklist: [], guidance: null, links: [], reminderLeadDays: DEFAULT_REMINDER_LEAD_DAYS, escalation: DEFAULT_ESCALATION, evidence: NO_EVIDENCE, penaltyNote: null, isActive: true };

const toValue = (row: ObligationTemplateRow): TemplateFormValue => ({ id: row.id, code: row.code, name: row.name, category: row.category, authority: row.authority, recurrence: row.recurrence, dueRule: row.dueRule, shift: row.shift, eventType: row.eventType, entityIds: row.entityIds, ownerRule: row.ownerRule, ownerPersonId: row.ownerPersonId, reviewerRule: row.reviewerRule, reviewerPersonId: row.reviewerPersonId, checklist: row.checklist, guidance: row.guidance, links: row.links, reminderLeadDays: row.reminderLeadDays, escalation: row.escalation, evidence: row.evidence, penaltyNote: row.penaltyNote, isActive: row.isActive });

// The obligation library (FR-OPS-01, 03). Anyone who reads compliance may read it; only a group-wide
// ops manager changes it or marks a template reviewed.
export default async function ObligationLibraryPage() {
  const user = await requireUser();
  if (!canReadOps(user.principal)) notFound();
  const t = await getTranslations("ops");
  const format = await getFormatter();
  const canEdit = canManageLibrary(user.principal);
  const [templates, entities, people] = await Promise.all([listTemplates(), listEntities(), canEdit ? listPersonNames() : []]);
  const options = { entities: entities.filter((entity) => entity.isActive).map(({ id, code }) => ({ id, code })), people, roles: [...ROLES], permissions: [...new Set(ROLES.flatMap((role) => ROLE_DEFINITIONS[role].permissions.filter((permission) => permission !== "*")))].sort() };
  const unreviewed = templates.filter((row) => row.reviewStatus !== "reviewed").length;

  const describeRule = (row: ObligationTemplateRow) => {
    const rule = row.dueRule;
    const day = rule.type === "after_event" ? "" : rule.day === "last" ? t("library.lastDay") : t("library.dayN", { day: rule.day });
    if (rule.type === "after_event") return t("library.ruleAfterEvent", { days: rule.days, event: t(`enums.event.${row.eventType ?? "hire"}`) });
    return rule.type === "after_period" ? t("library.ruleAfterPeriod", { day, months: rule.monthsAfter }) : t("library.ruleInPeriod", { day, month: rule.month });
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/ops" className="underline">
            {t("title")}
          </Link>
        </p>
        <h1>{t("library.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("library.description")}</p>
        {unreviewed > 0 ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("library.unreviewedCount", { count: unreviewed, total: templates.length })}</p> : null}
      </header>
      <OpsNav active="library" reads />

      {(["internal", "external"] as const).map((category) => (
        <section key={category} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t(`enums.category.${category}`)}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {templates
              .filter((row) => row.category === category)
              .map((row) => (
                <li key={row.id} className="text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3">
                      <span className="min-w-0 flex-1">
                        <span className={row.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>{row.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[row.code, t(`enums.recurrence.${row.recurrence}`), describeRule(row), t(`enums.authority.${row.authority}`)].join(" · ")}
                        </span>
                      </span>
                      {!row.isActive ? <Badge variant="outline">{t("library.inactive")}</Badge> : null}
                      {row.reviewStatus === "reviewed" ? <Badge variant="secondary">{t("library.reviewedOn", { date: row.reviewedAt ? format.dateTime(row.reviewedAt, { dateStyle: "medium" }) : "" })}</Badge> : <Badge variant="outline">{t("unreviewed")}</Badge>}
                    </summary>
                    <div className="border-t bg-muted/30">
                      {canEdit ? (
                        <>
                          <div className="flex justify-end px-3 pt-3">
                            <ReviewButton templateId={row.id} reviewed={row.reviewStatus === "reviewed"} />
                          </div>
                          <TemplateForm value={toValue(row)} options={options} />
                        </>
                      ) : (
                        <div className="flex flex-col gap-2 p-3">
                          {row.guidance ? <p className="whitespace-pre-line">{row.guidance}</p> : null}
                          {row.checklist.length ? (
                            <ol className="list-decimal pl-5">
                              {row.checklist.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                          ) : null}
                          {row.penaltyNote ? <p className="text-destructive">{row.penaltyNote}</p> : null}
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {canEdit ? (
        <section className="flex flex-col gap-2 rounded-xl border">
          <h2 className="px-3 pt-3 text-sm font-medium">{t("library.new")}</h2>
          <TemplateForm value={BLANK} options={options} />
        </section>
      ) : null}
    </div>
  );
}
