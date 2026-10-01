import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <Link href={file.canManage ? "/payroll/salaries" : "/payroll"} className="text-sm text-link hover:underline">
          ← {file.canManage ? t("salaries.title") : t("title")}
        </Link>
        <h1>{file.person.fullName}</h1>
        <p className="font-mono text-xs text-muted-foreground">{file.person.employeeCode}</p>
      </header>

      <TableCard>
        <TableCardHeader title={t("profiles.title")} count={file.profiles.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="select">{t("profiles.profile")}</TableHead>
              <TableHead kind="select">{t("profiles.basis")}</TableHead>
              <TableHead kind="date">{t("salaries.period")}</TableHead>
              <TableHead kind="status">{t("runs.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {file.profiles.length === 0 ? <TableEmpty>{t("salaries.noProfile")}</TableEmpty> : null}
            {file.profiles.map((profile) => (
              <TableRow key={profile.id}>
                <TableCell>
                  <Badge variant={profile.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${profile.profile}`)}</Badge>
                </TableCell>
                <TableCell>{profile.simpleBasis ? t(`profiles.bases.${profile.simpleBasis}`) : "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {day(profile.validFrom)} → {profile.validTo ? day(profile.validTo) : t("salaries.open")}
                </TableCell>
                <TableCell>{profile.status !== "approved" ? <Badge variant="outline">{t(`rules.status.${profile.status}`)}</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {file.canManage ? (
          <TableAddRow label={hasApprovedProfile ? t("profiles.form.titleChange") : t("profiles.form.title")} open={file.profiles.length === 0}>
            <ProfileForm personId={personId} />
          </TableAddRow>
        ) : null}
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("salaries.history")} count={file.structures.length || null} />
        <List>
          {file.structures.length === 0 ? <ListEmpty>{t("salaries.noStructure")}</ListEmpty> : null}
          {file.structures.map((structure) => (
            <ListItem key={structure.id} className="flex-col items-stretch gap-0 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {day(structure.validFrom)} → {structure.validTo ? day(structure.validTo) : t("salaries.open")}
                </span>
                <Badge variant="outline">{t(`salaries.reasons.${structure.reason}`)}</Badge>
                {structure.decisionNumber ? (
                  <Link href={`/payroll/salaries/decisions/${structure.id}`} className="text-xs text-link hover:underline">
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
            </ListItem>
          ))}
        </List>
      </TableCard>

      {file.canManage ? (
        <>
          <TableCard>
            <TableCardHeader title={t("salaries.requests")} count={file.requests.length || null} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="text">{t("salaries.request")}</TableHead>
                  <TableHead kind="status">{t("runs.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {file.requests.length === 0 ? <TableEmpty>{t("salaries.noRequests")}</TableEmpty> : null}
                {file.requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <Link href={`/payroll/salaries/changes/${request.id}`} className="hover:underline">
                        {request.summary}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`salaries.requestStatus.${request.status}` as "salaries.requestStatus.pending")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {openRequest ? null : (
              <TableAddRow label={file.structures.length === 0 ? t("salaries.form.titleInitial") : t("salaries.form.title")} open={file.requests.length === 0}>
                <SalaryChangeForm personId={personId} allowances={allowances} current={current?.terms ?? null} initial={file.structures.length === 0} bare />
              </TableAddRow>
            )}
          </TableCard>
          {openRequest ? <p className="text-sm text-muted-foreground">{t("salaries.changeOpen")}</p> : null}
        </>
      ) : null}
    </div>
  );
}
