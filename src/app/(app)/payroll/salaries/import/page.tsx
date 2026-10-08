import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { commitProfileImportAction, commitSalaryImportAction, stageProfileImportAction, stageSalaryImportAction } from "@/modules/payroll/import-actions";
import { listEntityOptions } from "@/modules/payroll/options";
import { canManageCompensation, compensationReach } from "@/modules/payroll/policy";
import { listPendingProfileImports, profileTemplate } from "@/modules/payroll/profile-import";
import { listPendingSalaryImports, salaryTemplate } from "@/modules/payroll/salary-import";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("salaryImport");

/**
 * Loading a company's salaries and pay profiles from spreadsheets (PAY-14). C&B over the entity
 * uploads; nothing takes effect until the owner has read the import on its own screen and approved
 * it there (a first Statutory profile excepted, as when typed by hand).
 */
export default async function SalaryImportPage({ searchParams }: PageProps<"/payroll/salaries/import">) {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/salaries/import");

  const params = await searchParams;
  const [t, format, entities, salaryImports, profileImports] = await Promise.all([getTranslations("payroll"), getFormatter(), listEntityOptions(reach), listPendingSalaryImports(user.principal), listPendingProfileImports(user.principal)]);
  if (entities.length === 0) notFound();
  const entityId = entities.find((entity) => entity.id === params.entity)?.id ?? entities[0].id;
  if (!canManageCompensation(user.principal, { entityId })) notFound();
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));
  const waiting = [...salaryImports.map((row) => ({ ...row, kind: "salary" as const })), ...profileImports.map((row) => ({ ...row, kind: "profile" as const }))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/payroll/salaries" className="text-link hover:underline">
            ← {t("salaries.title")}
          </Link>
        }
        title={t("imports.title")}
        description={t("imports.description")}
      />

      {/* ── Imports the owner has still to read and approve ── */}
      <Section title={t("imports.waiting")} count={waiting.length || undefined}>
        <List>
          {waiting.length === 0 ? <ListEmpty>{t("imports.noneWaiting")}</ListEmpty> : null}
          {waiting.map((row) => (
            <ListItem key={`${row.kind}:${row.batchId}`} href={`/payroll/salaries/imports/${row.batchId}`} className="flex-wrap gap-x-3 gap-y-1">
              <Badge variant="outline">{t(`imports.kinds.${row.kind}`)}</Badge>
              <span className="font-medium">{entityCode.get(row.entityId) ?? "—"}</span>
              <span className="text-muted-foreground">{t("imports.pending", { count: row.pending })}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
            </ListItem>
          ))}
        </List>
      </Section>

      <form className="toolbar" action="/payroll/salaries/import">
        <Select name="entity" defaultValue={entityId} aria-label={t("salaries.entity")} className="w-auto min-w-40">
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code} — {entity.shortName}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {t("salaries.filter")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("imports.forEntity")}{" "}
          <RecordLink kind="entity" id={entityId}>
            {entityCode.get(entityId)}
          </RecordLink>
        </span>
      </form>

      <Section title={t("imports.salaries.title")} description={t("imports.salaries.hint")}>
        <ImportWizard title={t("imports.salaries.wizard")} template={{ fileName: "luong.csv", csv: salaryTemplate() }} stageAction={stageSalaryImportAction} commitAction={commitSalaryImportAction}>
          <input type="hidden" name="entityId" value={entityId} />
        </ImportWizard>
      </Section>

      <Section title={t("imports.profiles.title")} description={t("imports.profiles.hint")}>
        <ImportWizard title={t("imports.profiles.wizard")} template={{ fileName: "ho-so-tra-luong.csv", csv: profileTemplate() }} stageAction={stageProfileImportAction} commitAction={commitProfileImportAction}>
          <input type="hidden" name="entityId" value={entityId} />
        </ImportWizard>
      </Section>
    </Page>
  );
}
