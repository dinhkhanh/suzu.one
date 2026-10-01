import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
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

  const [t, format, catalogue] = await Promise.all([getTranslations("payroll"), getFormatter(), resolveCatalogue(view.request.entityId, view.payload.validFrom)]);
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
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href={view.request.subjectPersonId && view.figures ? `/payroll/salaries/${view.request.subjectPersonId}` : "/approvals"} className="text-sm text-link hover:underline">
          ← {view.subjectName}
        </Link>
        <h1>{view.request.summary}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{t(`salaries.requestStatus.${view.request.status}` as "salaries.requestStatus.pending")}</Badge>
          {t("salaries.requestedBy", { name: view.requesterName })} · {t("salaries.effective", { date: day(view.payload.validFrom) })}
        </p>
      </header>

      {figures ? (
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
                <TableRow key={line.label} className={line.from !== null && line.from !== line.to ? "font-medium" : undefined}>
                  <TableCell>{line.label}</TableCell>
                  <TableCell kind="money">{line.from === null ? "—" : formatVnd(line.from)}</TableCell>
                  <TableCell kind="money">{formatVnd(line.to)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {figures.note ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">{figures.note}</p> : null}
        </TableCard>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("salaries.figuresHidden")}</p>
      )}

      <TableCard>
        <TableCardHeader title={t("salaries.steps")} count={view.steps.length || null} />
        <List>
          {view.steps.map((step) => (
            <ListItem key={step.key} className="flex-wrap gap-2">
              <Badge variant="outline">{step.status}</Badge>
              {step.assignees.map((assignee) => (
                <span key={assignee.personId}>
                  {assignee.name}
                  {assignee.comment ? <span className="text-muted-foreground"> — “{assignee.comment}”</span> : null}
                </span>
              ))}
            </ListItem>
          ))}
        </List>
      </TableCard>

      {view.canDecide ? <DecideSalaryChangeForm requestId={requestId} /> : null}
      {view.canResubmit && view.request.subjectPersonId && figures ? (
        <SalaryChangeForm personId={view.request.subjectPersonId} allowances={allowanceOptions} current={figures.proposed} initial={view.payload.initial} requestId={requestId} defaults={{ validFrom: view.payload.validFrom, reason: view.payload.reason, note: figures.note }} />
      ) : null}
      {view.isRequester && (view.request.status === "pending" || view.request.status === "returned") ? <WithdrawSalaryChangeButton requestId={requestId} /> : null}
    </div>
  );
}
