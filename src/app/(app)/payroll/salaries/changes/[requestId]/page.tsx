import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { requestCode } from "@/modules/platform/approvals/ui/request-views";
import { resolveCatalogue } from "@/modules/payroll/components";
import { BASE_SALARY_CODE, getSalaryChange } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { DecideSalaryChangeForm, SalaryChangeForm, WithdrawSalaryChangeButton } from "@/modules/payroll/ui/salary-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("salaryChange");

// A salary change request. Opens for its requester, its approvers and C&B over the entity; the
// figures appear only for someone payroll trusts with them, whatever the flow says.
export default async function SalaryChangePage({ params }: PageProps<"/payroll/salaries/changes/[requestId]">) {
  const user = await requireUser();
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(requestId)) notFound();
  const view = await getSalaryChange({ personId: user.person.id, principal: user.principal }, requestId);
  if (!view) notFound();
  requireStepUp(user, `/payroll/salaries/changes/${requestId}`);

  const [t, tApprovals, format, catalogue] = await Promise.all([getTranslations("payroll"), getTranslations("approvals"), getFormatter(), resolveCatalogue(view.request.entityId, view.payload.validFrom)]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const names = new Map(catalogue.map((component) => [component.code, component.name]));
  const allowanceOptions = catalogue.filter((component) => component.source === "structure" && component.kind === "earning" && component.code !== BASE_SALARY_CODE).map((component) => ({ code: component.code, name: component.name }));
  const figures = view.figures;
  const codes = figures ? [...new Set([...(figures.current?.allowances ?? []), ...figures.proposed.allowances].map((line) => line.code))] : [];
  const amountOf = (terms: { allowances: { code: string; amount: number }[] } | null, code: string) => terms?.allowances.find((line) => line.code === code)?.amount ?? 0;
  const lines = figures
    ? [
        { label: t("salaries.baseSalary"), from: figures.current?.baseSalary ?? null, to: figures.proposed.baseSalary },
        { label: t("salaries.insuranceSalary"), from: figures.current?.insuranceSalary ?? null, to: figures.proposed.insuranceSalary },
        ...codes.map((code) => ({ label: names.get(code) ?? code, from: figures.current ? amountOf(figures.current, code) : null, to: amountOf(figures.proposed, code) })),
      ]
    : [];

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tApprovals("types.salary_change")}</Badge>
            <span className="font-mono text-xs text-faint tabular-nums">{requestCode(view.request.id)}</span>
            <Badge dot variant={statusTone(view.request.status)}>
              {t(`salaries.requestStatus.${view.request.status}` as "salaries.requestStatus.pending")}
            </Badge>
          </span>
        }
        title={view.request.summary}
        description={
          <>
            {/* The pay file for whoever reads the figures; the colleague's profile for an approver who does not. */}
            {view.request.subjectPersonId && view.figures ? (
              <Link href={`/payroll/salaries/${view.request.subjectPersonId}`} className="text-link hover:underline">
                {view.subjectName}
              </Link>
            ) : (
              <RecordLink kind="person" id={view.request.subjectPersonId}>
                {view.subjectName}
              </RecordLink>
            )}
            {" · "}
            {t.rich("salaries.requestedBy", {
              name: view.requesterName,
              person: (chunks) => (
                <RecordLink kind="person" id={view.request.requesterPersonId}>
                  {chunks}
                </RecordLink>
              ),
            })}{" "}
            · {t("salaries.effective", { date: day(view.payload.validFrom) })}
          </>
        }
      />

      {figures ? (
        <Section title={t("salaries.component")}>
          <TableCard>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="text">{t("salaries.component")}</TableHead>
                  <TableHead kind="money">{t("salaries.currentTerms")}</TableHead>
                  <TableHead kind="money">{t("salaries.proposedTerms")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.label}>
                    <TableCell>{line.label}</TableCell>
                    <TableCell kind="money" className="text-muted-foreground">
                      {line.from === null ? "—" : formatVnd(line.from)}
                    </TableCell>
                    <TableCell kind="money" className={line.from !== null && line.from !== line.to ? "font-semibold" : undefined}>
                      {formatVnd(line.to)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {figures.note ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">{figures.note}</p> : null}
          </TableCard>
        </Section>
      ) : (
        <Alert variant="neutral">{t("salaries.figuresHidden")}</Alert>
      )}

      <Section title={t("salaries.steps")} count={view.steps.length || undefined}>
        <List>
          {view.steps.map((step) => (
            <ListItem key={step.key} className="flex-wrap gap-2">
              <Badge dot variant={statusTone(step.status)}>
                {tApprovals.has(`assignee.${step.status}`) ? tApprovals(`assignee.${step.status}` as "assignee.pending") : step.status}
              </Badge>
              {step.assignees.map((assignee) => (
                <span key={assignee.personId}>
                  <RecordLink kind="person" id={assignee.personId}>
                    {assignee.name}
                  </RecordLink>
                  {assignee.comment ? <span className="text-muted-foreground"> — “{assignee.comment}”</span> : null}
                </span>
              ))}
            </ListItem>
          ))}
        </List>
      </Section>

      {view.canDecide ? <DecideSalaryChangeForm requestId={requestId} /> : null}
      {view.canResubmit && view.request.subjectPersonId && figures ? (
        <SalaryChangeForm
          personId={view.request.subjectPersonId}
          allowances={allowanceOptions}
          current={figures.proposed}
          initial={view.payload.initial}
          requestId={requestId}
          defaults={{ validFrom: view.payload.validFrom, reason: view.payload.reason, note: figures.note }}
        />
      ) : null}
      {view.isRequester && (view.request.status === "pending" || view.request.status === "returned") ? <WithdrawSalaryChangeButton requestId={requestId} /> : null}
    </Page>
  );
}
