import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { resolveCatalogue } from "@/modules/payroll/components";
import { canVoidProfile, canVoidSalaryStructure } from "@/modules/payroll/policy";
import { voidProfileAction } from "@/modules/payroll/rule-actions";
import { voidSalaryStructureAction } from "@/modules/payroll/salary-actions";
import { BASE_SALARY_CODE, getSalaryFile } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { VoidVersionButton } from "@/modules/platform/statutory/ui/void-version";
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
  // Taking a wrong version back (PAY-13): a structure is the owner's; a profile the owner's, or C&B's
  // for a first Statutory one nobody had to approve. The actions ask again.
  const voidsStructures = canVoidSalaryStructure(user.principal, { entityId: file.person.entityId });
  const voidsProfile = (profile: (typeof file.profiles)[number]) => profile.status === "approved" && canVoidProfile(user.principal, profile);
  const anyProfileVoidable = file.profiles.some(voidsProfile);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href={file.canManage ? "/payroll/salaries" : "/payroll"} className="text-link hover:underline">
            ← {file.canManage ? t("salaries.title") : t("title")}
          </Link>
        }
        title={<RecordLink kind="person" id={personId}>{file.person.fullName}</RecordLink>}
        description={<span className="font-mono text-xs tabular-nums">{file.person.employeeCode}</span>}
      />

      <Section title={t("profiles.title")} count={file.profiles.length || undefined}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("profiles.profile")}</TableHead>
                <TableHead kind="select">{t("profiles.basis")}</TableHead>
                <TableHead kind="date">{t("salaries.period")}</TableHead>
                <TableHead kind="status">{t("runs.status")}</TableHead>
                {anyProfileVoidable ? <TableHead kind="actions" /> : null}
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
                  <TableCell className="max-w-64 whitespace-normal">
                    <Badge dot variant={statusTone(profile.status)}>{t(`rules.status.${profile.status}`)}</Badge>
                    {profile.status === "voided" ? <span className="mt-0.5 block text-xs text-muted-foreground">{t("rules.voided.because", { reason: profile.voidReason ?? "—" })}</span> : null}
                  </TableCell>
                  {anyProfileVoidable ? (
                    <TableCell kind="actions">
                      {voidsProfile(profile) ? <VoidVersionButton action={voidProfileAction} id={profile.id} title={`${t(`profiles.kinds.${profile.profile}`)} — ${day(profile.validFrom)}`} errorNamespace="payroll.errors" /> : null}
                    </TableCell>
                  ) : null}
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
      </Section>

      <Section title={t("salaries.history")} count={file.structures.length || undefined}>
        <List>
          {file.structures.length === 0 ? <ListEmpty>{t("salaries.noStructure")}</ListEmpty> : null}
          {file.structures.map((structure) => (
            <ListItem key={structure.id} className="flex-col items-stretch gap-2 py-3">
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
                {voidsStructures ? (
                  <span className="ml-auto">
                    <VoidVersionButton action={voidSalaryStructureAction} id={structure.id} title={`${t("salaries.history")} — ${day(structure.validFrom)}`} errorNamespace="payroll.errors" />
                  </span>
                ) : null}
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 text-sm sm:max-w-md">
                <dt className="text-muted-foreground">{t("salaries.baseSalary")}</dt>
                <dd className="text-right font-mono text-[0.8125rem] font-medium tabular-nums">{formatVnd(structure.terms.baseSalary)}</dd>
                <dt className="text-muted-foreground">{t("salaries.insuranceSalary")}</dt>
                <dd className="text-right font-mono text-[0.8125rem] tabular-nums">{formatVnd(structure.terms.insuranceSalary)}</dd>
                {structure.terms.allowances.map((line) => (
                  <div key={line.code} className="contents">
                    <dt className="text-muted-foreground">{names.get(line.code) ?? line.code}</dt>
                    <dd className="text-right font-mono text-[0.8125rem] tabular-nums">{formatVnd(line.amount)}</dd>
                  </div>
                ))}
                {structure.terms.probationPercent ? (
                  <>
                    <dt className="text-muted-foreground">{t("salaries.probationPercent")}</dt>
                    <dd className="text-right font-mono text-[0.8125rem] tabular-nums">{structure.terms.probationPercent}%</dd>
                  </>
                ) : null}
              </dl>
            </ListItem>
          ))}
        </List>
      </Section>

      {/* Structures voided as wrong (PAY-13): no longer in force, kept with who took them back and why. */}
      {file.voided.length > 0 ? (
        <Section title={t("rules.voided.title")} count={file.voided.length}>
          <List>
            {file.voided.map((structure) => (
              <ListItem key={structure.id} className="flex-col items-stretch gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-muted-foreground line-through">
                    {day(structure.validFrom)} → {structure.validTo ? day(structure.validTo) : t("salaries.open")}
                  </span>
                  <Badge variant="outline">{t(`salaries.reasons.${structure.reason}`)}</Badge>
                  <Badge dot variant={statusTone("voided")}>{t("rules.status.voided")}</Badge>
                  <span className="font-mono text-[0.8125rem] tabular-nums text-muted-foreground">{formatVnd(structure.terms.baseSalary)}</span>
                </span>
                <span className="text-sm text-muted-foreground">{t("rules.voided.because", { reason: structure.voidReason ?? "—" })}</span>
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      {file.canManage ? (
        <Section title={t("salaries.requests")} count={file.requests.length || undefined}>
          <TableCard>
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
                    <TableCell className="max-w-96 whitespace-normal">
                      <Link href={`/payroll/salaries/changes/${request.id}`} className="font-medium hover:underline">
                        {request.summary}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(request.status)}>{t(`salaries.requestStatus.${request.status}` as "salaries.requestStatus.pending")}</Badge>
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
        </Section>
      ) : null}
    </Page>
  );
}
