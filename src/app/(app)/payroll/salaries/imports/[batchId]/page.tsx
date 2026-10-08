import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { canDecidePayRules } from "@/modules/payroll/policy";
import { listProfileImport } from "@/modules/payroll/profile-import";
import { getSalaryImport } from "@/modules/payroll/salary-import";
import { ApproveImportButton } from "@/modules/payroll/ui/import-forms";
import { formatVnd } from "@/modules/payroll/ui/money";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("salaryImportReview");

const total = (terms: { allowances: { amount: number }[] }) => terms.allowances.reduce((sum, line) => sum + line.amount, 0);

/**
 * One import, read before it is approved (PAY-14): every proposed salary beside the one it replaces,
 * every proposed pay profile. The owner approves what is on this screen in one go; each request is
 * still decided on its own, and any of them can be opened and returned instead.
 */
export default async function SalaryImportReviewPage({ params }: PageProps<"/payroll/salaries/imports/[batchId]">) {
  const user = await requireUser();
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(batchId)) notFound();
  const viewer = { personId: user.person.id, principal: user.principal };
  const [salaries, profiles] = await Promise.all([getSalaryImport(viewer, batchId), listProfileImport(user.principal, batchId)]);
  // Somebody else's import, or none at all: the same answer.
  if (!salaries && profiles.length === 0) notFound();
  requireStepUp(user, `/payroll/salaries/imports/${batchId}`);

  const [t, format] = await Promise.all([getTranslations("payroll"), getFormatter()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const pendingSalaries = (salaries?.lines ?? []).filter((line) => line.status === "pending");
  const pendingProfiles = profiles.filter((profile) => profile.status === "proposed");
  const decides = canDecidePayRules(user.principal);

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll/salaries/import" className="text-link hover:underline">
            ← {t("imports.title")}
          </Link>
        }
        title={t("imports.review.title")}
        description={t("imports.review.description")}
      />

      {salaries ? (
        <Section title={t("imports.kinds.salary")} count={salaries.lines.length} description={t("imports.pending", { count: salaries.pending })}>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person">{t("salaries.person")}</TableHead>
                  <TableHead kind="date">{t("salaries.validFrom")}</TableHead>
                  <TableHead kind="select">{t("salaries.reason")}</TableHead>
                  <TableHead kind="money">{t("imports.review.currentBase")}</TableHead>
                  <TableHead kind="money">{t("salaries.baseSalary")}</TableHead>
                  <TableHead kind="money">{t("salaries.insuranceSalary")}</TableHead>
                  <TableHead kind="money">{t("imports.review.allowances")}</TableHead>
                  <TableHead kind="status">{t("runs.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaries.lines.length === 0 ? <TableEmpty>{t("imports.review.empty")}</TableEmpty> : null}
                {salaries.lines.map((line) => (
                  <TableRow key={line.requestId}>
                    <TableCell>
                      <RecordLink kind="person" id={line.personId} className="font-medium">
                        {line.fullName}
                      </RecordLink>
                      <span className="ml-2 font-mono text-xs text-faint">{line.employeeCode}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{day(line.payload.validFrom)}</TableCell>
                    <TableCell>
                      <Link href={`/payroll/salaries/changes/${line.requestId}`} className="hover:underline">
                        {t(`salaries.reasons.${line.payload.reason}`)}
                      </Link>
                      {line.proposed.probationPercent ? <span className="ml-1.5 text-xs text-muted-foreground">({t("salaries.probationShort", { percent: line.proposed.probationPercent })})</span> : null}
                    </TableCell>
                    <TableCell kind="money" className="text-muted-foreground">
                      {line.current ? formatVnd(line.current.baseSalary) : "—"}
                    </TableCell>
                    <TableCell kind="money" className="font-medium">
                      {formatVnd(line.proposed.baseSalary)}
                    </TableCell>
                    <TableCell kind="money">{formatVnd(line.proposed.insuranceSalary)}</TableCell>
                    <TableCell kind="money">{formatVnd(total(line.proposed))}</TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(line.status)}>
                        {t(`salaries.requestStatus.${line.status}` as "salaries.requestStatus.pending")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          {salaries.canApprove ? <ApproveImportButton kind="salary" batchId={batchId} ids={pendingSalaries.map((line) => line.requestId)} /> : null}
        </Section>
      ) : null}

      {profiles.length > 0 ? (
        <Section title={t("imports.kinds.profile")} count={profiles.length} description={t("imports.pending", { count: pendingProfiles.length })}>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person">{t("salaries.person")}</TableHead>
                  <TableHead kind="select">{t("profiles.profile")}</TableHead>
                  <TableHead kind="select">{t("profiles.basis")}</TableHead>
                  <TableHead kind="date">{t("profiles.validFrom")}</TableHead>
                  <TableHead kind="select">{t("profiles.pitMethod")}</TableHead>
                  <TableHead kind="status">{t("runs.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <RecordLink kind="person" id={profile.personId} className="font-medium">
                        {profile.fullName}
                      </RecordLink>
                      <span className="ml-2 font-mono text-xs text-faint">{profile.employeeCode}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={profile.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${profile.profile}`)}</Badge>
                    </TableCell>
                    <TableCell>{profile.simpleBasis ? t(`profiles.bases.${profile.simpleBasis}`) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{day(profile.validFrom)}</TableCell>
                    <TableCell className="text-muted-foreground">{t(`profiles.pitMethods.${profile.pitMethod}`)}</TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(profile.status)}>
                        {t(`rules.status.${profile.status}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          {decides && pendingProfiles.length > 0 ? <ApproveImportButton kind="profile" batchId={batchId} ids={pendingProfiles.map((profile) => profile.id)} /> : null}
        </Section>
      ) : null}
    </Page>
  );
}
