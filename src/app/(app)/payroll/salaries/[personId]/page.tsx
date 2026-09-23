import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { resolveCatalogue } from "@/modules/payroll/components";
import { BASE_SALARY_CODE, getSalaryFile } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ProfileForm, SalaryChangeForm } from "@/modules/payroll/ui/salary-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payFile");

// One person's pay file: their own, or C&B over their entity. Anyone else — the line manager, the
// department head, an id that does not exist — gets the same 404.
export default async function SalaryFilePage({ params }: PageProps<"/payroll/salaries/[personId]">) {
  const user = await requireUser();
  const { personId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(personId)) notFound();
  const file = await getSalaryFile({ personId: user.person.id, principal: user.principal }, personId);
  if (!file) notFound();
  requireStepUp(user, `/payroll/salaries/${personId}`);

  const today = todayInVietnam();
  const [t, format, catalogue] = await Promise.all([getTranslations("payroll"), getFormatter(), resolveCatalogue(file.person.entityId, today)]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const names = new Map(catalogue.map((component) => [component.code, component.name]));
  const allowances = catalogue.filter((component) => component.source === "structure" && component.kind === "earning" && component.code !== BASE_SALARY_CODE).map((component) => ({ code: component.code, name: component.name }));
  const current = file.structures.find((structure) => structure.validFrom <= today && (structure.validTo === null || structure.validTo >= today)) ?? file.structures[0] ?? null;
  const openRequest = file.requests.find((request) => request.status === "pending" || request.status === "returned");
  const hasApprovedProfile = file.profiles.some((profile) => profile.status === "approved");

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <Link href={file.canManage ? "/payroll/salaries" : "/payroll"} className="text-sm text-muted-foreground hover:underline">
          ← {file.canManage ? t("salaries.title") : t("title")}
        </Link>
        <h1>{file.person.fullName}</h1>
        <p className="font-mono text-xs text-muted-foreground">{file.person.employeeCode}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("profiles.title")}</h2>
        {file.profiles.length === 0 ? <p className="text-sm text-muted-foreground">{t("salaries.noProfile")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {file.profiles.map((profile) => (
            <li key={profile.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Badge variant={profile.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${profile.profile}`)}</Badge>
              {profile.simpleBasis ? <span>{t(`profiles.bases.${profile.simpleBasis}`)}</span> : null}
              <span className="text-muted-foreground">
                {day(profile.validFrom)} → {profile.validTo ? day(profile.validTo) : t("salaries.open")}
              </span>
              {profile.status !== "approved" ? <Badge variant="outline">{t(`rules.status.${profile.status}`)}</Badge> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("salaries.history")}</h2>
        {file.structures.length === 0 ? <p className="text-sm text-muted-foreground">{t("salaries.noStructure")}</p> : null}
        <ul className="flex flex-col gap-3">
          {file.structures.map((structure) => (
            <li key={structure.id} className="rounded-xl border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {day(structure.validFrom)} → {structure.validTo ? day(structure.validTo) : t("salaries.open")}
                </span>
                <Badge variant="outline">{t(`salaries.reasons.${structure.reason}`)}</Badge>
                {structure.decisionNumber ? (
                  <Link href={`/payroll/salaries/decisions/${structure.id}`} className="text-xs text-muted-foreground hover:underline">
                    {t("salaries.decision", { number: structure.decisionNumber })}
                  </Link>
                ) : null}
              </div>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 sm:max-w-md">
                <dt>{t("salaries.baseSalary")}</dt>
                <dd className="text-right tabular-nums">{formatVnd(structure.terms.baseSalary)}</dd>
                <dt>{t("salaries.insuranceSalary")}</dt>
                <dd className="text-right tabular-nums">{formatVnd(structure.terms.insuranceSalary)}</dd>
                {structure.terms.allowances.map((line) => (
                  <div key={line.code} className="contents">
                    <dt>{names.get(line.code) ?? line.code}</dt>
                    <dd className="text-right tabular-nums">{formatVnd(line.amount)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>

      {file.canManage ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("salaries.requests")}</h2>
            {file.requests.length === 0 ? <p className="text-sm text-muted-foreground">{t("salaries.noRequests")}</p> : null}
            <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
              {file.requests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <Link href={`/payroll/salaries/changes/${request.id}`} className="hover:underline">
                    {request.summary}
                  </Link>
                  <Badge variant="outline">{t(`salaries.requestStatus.${request.status}` as "salaries.requestStatus.pending")}</Badge>
                </li>
              ))}
            </ul>
          </section>
          {openRequest ? <p className="text-sm text-muted-foreground">{t("salaries.changeOpen")}</p> : <SalaryChangeForm personId={personId} allowances={allowances} current={current?.terms ?? null} initial={file.structures.length === 0} />}
          <ProfileForm personId={personId} hasProfile={hasApprovedProfile} />
        </>
      ) : null}
    </div>
  );
}
