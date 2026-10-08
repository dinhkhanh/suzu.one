import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { findRunPerson, openRunPerson } from "@/modules/payroll/run-views";
import { formatVnd } from "@/modules/payroll/ui/money";
import { PayslipDetail } from "@/modules/payroll/ui/payslip-detail";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollRunPerson");

/** "2026-09" → "09/2026". */
const monthLabel = (month: string) => month.split("-").reverse().join("/");

/**
 * One person's calculated lines in a run, with the working and the explanation trace — what their
 * payslip will say, read by C&B **before** the run is proposed (FR-PAY-20, FR-PAY-31). The same
 * renderer as the published payslip, so the two can never disagree.
 *
 * C&B over the run's entity, or the owner; anyone else gets the 404 of a line that does not exist
 * (`findRunPerson` decides). Compensation tier: a fresh re-authentication first, and the read is
 * written to the audit log (`openRunPerson`).
 */
export default async function PayrollRunPersonPage({ params }: PageProps<"/payroll/runs/[runId]/people/[personId]">) {
  const user = await requireUser();
  const { runId, personId } = await params;
  const uuid = /^[0-9a-f-]{36}$/;
  if (!uuid.test(runId) || !uuid.test(personId)) notFound();
  const handle = await findRunPerson(user.principal, runId, personId);
  if (!handle) notFound();
  requireStepUp(user, `/payroll/runs/${runId}/people/${personId}`);

  const [t, view] = await Promise.all([getTranslations("payroll"), openRunPerson({ userId: user.userId, email: user.email, person: user.person, request: user.request }, handle)]);
  const { run, entity, person, result } = view;
  // Until the CEO has signed, these are working figures: they may still change.
  const provisional = !run.approvedAt;

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/payroll/runs/${run.id}`} className="text-link hover:underline">
              ← <span className="font-mono tabular-nums">{run.month}</span> · {entity.code}
            </Link>
            <span className="text-faint">·</span>
            <Badge dot variant={statusTone(run.status)}>
              {t(`runs.statuses.${run.status}`)}
            </Badge>
          </span>
        }
        title={t("runs.lines.title", { month: monthLabel(run.month) })}
        description={run.kind === "off_cycle" && run.name ? run.name : undefined}
        aside={
          <span className="flex flex-col md:items-end">
            <span className="section-label">{t("payslips.net")}</span>
            <span className="font-mono text-[30px] leading-none font-medium tracking-[-0.02em] tabular-nums">{formatVnd(result.totals.net)}</span>
          </span>
        }
      />

      {provisional ? <Alert variant="info">{t("runs.lines.provisional")}</Alert> : null}

      <PayslipDetail result={result} componentNames={view.componentNames} person={person} entity={entity} month={run.month} runName={run.kind === "off_cycle" ? run.name : null} />

      {/* ── What was typed into the run for them: the figures the lines above came from ── */}
      {view.inputs.length > 0 ? (
        <Section title={t("runs.inputs.title")} count={view.inputs.length}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("runs.inputs.code")}</TableHead>
                <TableHead kind="text">{t("runs.inputs.note")}</TableHead>
                <TableHead kind="money">{t("runs.inputs.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.inputs.map((input) => (
                <TableRow key={input.code}>
                  <TableCell className="whitespace-normal">
                    {view.componentNames.get(input.code) ?? input.code}
                    <span className="ml-2 font-mono text-xs text-faint">{input.code}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{input.note ?? "—"}</TableCell>
                  <TableCell kind="money">{formatVnd(input.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </Page>
  );
}
