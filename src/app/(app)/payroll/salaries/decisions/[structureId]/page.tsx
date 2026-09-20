import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { getSalaryDecision } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";

export const metadata: Metadata = { title: "Salary decision" };

// The decision document of a salary change (FR-PAY-04), generated from the structure every time
// it is opened — printed from the browser, nothing stored. For the person and C&B.
export default async function SalaryDecisionPage({ params }: PageProps<"/payroll/salaries/decisions/[structureId]">) {
  const user = await requireUser();
  const { structureId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(structureId)) notFound();
  const decision = await getSalaryDecision({ personId: user.person.id, principal: user.principal }, structureId);
  if (!decision) notFound();
  requireStepUp(user, `/payroll/salaries/decisions/${structureId}`);
  const t = await getTranslations("payroll.decision");
  const day = (value: string) => value.split("-").reverse().join("/");
  const { structure, previous, entity } = decision;
  const name = (code: string) => decision.componentNames[code] ?? code;
  const initial = structure.reason === "initial";

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 bg-background p-6 text-sm leading-relaxed print:p-0">
      <header className="flex justify-between gap-6 text-center text-xs">
        <div>
          <p className="font-semibold uppercase">{entity.legalName}</p>
          <p>{t("number", { number: structure.decisionNumber ?? "—" })}</p>
        </div>
        <div>
          <p className="font-semibold uppercase">{t("republic")}</p>
          <p className="font-semibold">{t("motto")}</p>
        </div>
      </header>
      <h1 className="text-center text-lg font-semibold uppercase">{initial ? t("titleInitial") : t("title")}</h1>
      <p>{t("basis")}</p>
      <p className="font-semibold">{t("article1", { name: decision.personName, code: decision.employeeCode ?? "—", date: day(structure.validFrom) })}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 font-medium">{t("component")}</th>
            {previous ? <th className="py-1 text-right font-medium">{t("before")}</th> : null}
            <th className="py-1 text-right font-medium">{t("after")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t("baseSalary")}</td>
            {previous ? <td className="text-right tabular-nums">{formatVnd(previous.terms.baseSalary)}</td> : null}
            <td className="text-right tabular-nums">{formatVnd(structure.terms.baseSalary)}</td>
          </tr>
          <tr>
            <td>{t("insuranceSalary")}</td>
            {previous ? <td className="text-right tabular-nums">{formatVnd(previous.terms.insuranceSalary)}</td> : null}
            <td className="text-right tabular-nums">{formatVnd(structure.terms.insuranceSalary)}</td>
          </tr>
          {[...new Set([...(previous?.terms.allowances ?? []), ...structure.terms.allowances].map((line) => line.code))].map((code) => (
            <tr key={code}>
              <td>{name(code)}</td>
              {previous ? <td className="text-right tabular-nums">{formatVnd(previous.terms.allowances.find((line) => line.code === code)?.amount ?? 0)}</td> : null}
              <td className="text-right tabular-nums">{formatVnd(structure.terms.allowances.find((line) => line.code === code)?.amount ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t("article2")}</p>
      <p>{t("article3")}</p>
      <footer className="mt-8 flex justify-end">
        <div className="text-center">
          <p className="font-semibold uppercase">{t("signatory")}</p>
          <p className="text-xs text-muted-foreground">{t("signHint")}</p>
          <p className="mt-16 font-semibold">{entity.legalRepresentative ?? ""}</p>
        </div>
      </footer>
      <p className="text-xs text-muted-foreground print:hidden">{t("printHint", { approver: decision.decidedByName ?? "—" })}</p>
    </article>
  );
}
