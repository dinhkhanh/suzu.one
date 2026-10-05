import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { getSalaryDecision } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("salaryDecision");

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
      <Table numbered={false}>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("component")}</TableHead>
            {previous ? <TableHead kind="money">{t("before")}</TableHead> : null}
            <TableHead kind="money">{t("after")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{t("baseSalary")}</TableCell>
            {previous ? <TableCell kind="money">{formatVnd(previous.terms.baseSalary)}</TableCell> : null}
            <TableCell kind="money">{formatVnd(structure.terms.baseSalary)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{t("insuranceSalary")}</TableCell>
            {previous ? <TableCell kind="money">{formatVnd(previous.terms.insuranceSalary)}</TableCell> : null}
            <TableCell kind="money">{formatVnd(structure.terms.insuranceSalary)}</TableCell>
          </TableRow>
          {[...new Set([...(previous?.terms.allowances ?? []), ...structure.terms.allowances].map((line) => line.code))].map((code) => (
            <TableRow key={code}>
              <TableCell>{name(code)}</TableCell>
              {previous ? <TableCell kind="money">{formatVnd(previous.terms.allowances.find((line) => line.code === code)?.amount ?? 0)}</TableCell> : null}
              <TableCell kind="money">{formatVnd(structure.terms.allowances.find((line) => line.code === code)?.amount ?? 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
