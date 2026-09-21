import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { resolveCatalogue } from "@/modules/payroll/components";
import { BASE_SALARY_CODE, getSalaryChange } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { DecideSalaryChangeForm, SalaryChangeForm, WithdrawSalaryChangeButton } from "@/modules/payroll/ui/salary-forms";

export const metadata: Metadata = { title: "Salary change" };

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
        <Link href={view.request.subjectPersonId && view.figures ? `/payroll/salaries/${view.request.subjectPersonId}` : "/approvals"} className="text-sm text-muted-foreground hover:underline">
          ← {view.subjectName}
        </Link>
        <h1>{view.request.summary}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{t(`salaries.requestStatus.${view.request.status}` as "salaries.requestStatus.pending")}</Badge>
          {t("salaries.requestedBy", { name: view.requesterName })} · {t("salaries.effective", { date: day(view.payload.validFrom) })}
        </p>
      </header>

      {figures ? (
        <section className="rounded-xl border p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">{t("salaries.component")}</th>
                <th className="text-right font-normal">{t("salaries.currentTerms")}</th>
                <th className="text-right font-normal">{t("salaries.proposedTerms")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.label} className={line.from !== null && line.from !== line.to ? "font-medium" : undefined}>
                  <td>{line.label}</td>
                  <td className="text-right tabular-nums">{line.from === null ? "—" : formatVnd(line.from)}</td>
                  <td className="text-right tabular-nums">{formatVnd(line.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {figures.note ? <p className="mt-3 text-sm text-muted-foreground">{figures.note}</p> : null}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("salaries.figuresHidden")}</p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("salaries.steps")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {view.steps.map((step) => (
            <li key={step.key} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Badge variant="outline">{step.status}</Badge>
              {step.assignees.map((assignee) => (
                <span key={assignee.personId}>
                  {assignee.name}
                  {assignee.comment ? <span className="text-muted-foreground"> — “{assignee.comment}”</span> : null}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {view.canDecide ? <DecideSalaryChangeForm requestId={requestId} /> : null}
      {view.canResubmit && view.request.subjectPersonId && figures ? (
        <SalaryChangeForm personId={view.request.subjectPersonId} allowances={allowanceOptions} current={figures.proposed} initial={view.payload.initial} requestId={requestId} defaults={{ validFrom: view.payload.validFrom, reason: view.payload.reason, note: figures.note }} />
      ) : null}
      {view.isRequester && (view.request.status === "pending" || view.request.status === "returned") ? <WithdrawSalaryChangeButton requestId={requestId} /> : null}
    </div>
  );
}
