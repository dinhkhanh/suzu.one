import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { listPeople } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { canSetRecruitMoney, getOpeningView, listApplications, listCandidates } from "@/modules/recruit/service";
import { AddApplicationForm } from "@/modules/recruit/ui/add-application";
import { HiringTeamForm, OpeningStatusControls } from "@/modules/recruit/ui/opening-controls";
import { pageTitle } from "@/i18n/page-title";
import { publicOrigin } from "@/lib/site";
import { OPENING_PUBLIC_STATUSES } from "@/modules/recruit/enums";
import { CareersLinks } from "@/modules/recruit/ui/careers-link";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("jobOpening");

// One opening: what the job is, who is hiring for it, and everybody currently walking its
// pipeline, grouped by stage — the list the kanban board of week 2 will draw as columns.
export default async function OpeningPage({ params }: PageProps<"/recruit/[openingId]">) {
  const { openingId } = await params;
  const user = await requireUser();
  const view = await getOpeningView({ principal: user.principal, personId: user.person.id }, openingId);
  // A refused opening answers exactly like one that does not exist.
  if (!view) notFound();

  // Candidates this person may already see, minus the ones on this opening — the rest of the
  // database stays out of reach exactly as it is on /recruit/candidates.
  const [t, format, applications, people, candidates] = await Promise.all([
    getTranslations("recruit"),
    getFormatter(),
    listApplications({ principal: user.principal, personId: user.person.id }, openingId),
    view.canEdit ? listPeople(user.principal, {}, { pageSize: 500 }).then((page) => page.rows.map((row) => ({ id: row.id, fullName: row.fullName }))) : [],
    view.canEdit ? listCandidates(user.principal, { notAppliedTo: openingId, identifiedOnly: true }).then((rows) => rows.map((row) => ({ id: row.id, fullName: row.fullName }))) : [],
  ]);

  const byStage = view.stages.map((stage) => ({ stage, rows: applications.filter((row) => row.stageId === stage.id && row.status === "active") }));
  const closed = applications.filter((row) => row.status !== "active");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{view.opening.code}</p>
            <h1>{view.opening.title}</h1>
            <p className="text-sm text-muted-foreground">
              {[view.entityName, view.departmentName, view.teamName, t(`employmentType.${view.opening.employmentType}`), t(`workMode.${view.opening.workMode}`), view.opening.workLocation].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge dot variant={statusTone(view.opening.status)}>{t(`status.${view.opening.status}`)}</Badge>
            <div className="flex gap-2">
              {/* Only an open opening has a public page; any other status answers 404 there. */}
              {OPENING_PUBLIC_STATUSES.includes(view.opening.status) ? <CareersLinks url={`${publicOrigin()}/careers/${view.opening.publicSlug}`} /> : null}
              <Link href={`/recruit/${openingId}/board`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t("board.title")}
              </Link>
              {view.canEdit ? (
                <Link href={`/recruit/${openingId}/edit`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  {t("actions.edit")}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {view.canEdit ? <OpeningStatusControls openingId={openingId} status={view.opening.status} /> : null}
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <dl className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("columns.headcount")}</dt>
            <dd>{view.opening.headcount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("columns.pipeline")}</dt>
            <dd>{view.pipeline?.name}</dd>
          </div>
          {view.opening.targetStartDate ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("form.targetStartDate")}</dt>
              <dd>{view.opening.targetStartDate}</dd>
            </div>
          ) : null}
          {/* Null means "not yours to see", and the row simply is not drawn. */}
          {view.salary ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("columns.salary")}</dt>
              <dd>
                {[view.salary.minVnd, view.salary.maxVnd]
                  .filter((value): value is number => value !== null)
                  .map((value) => format.number(value))
                  .join(" – ") || "—"}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("columns.team")}</h2>
          {view.canEdit ? (
            <HiringTeamForm openingId={openingId} members={view.members.map((member) => ({ personId: member.personId, role: member.role }))} people={people} />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {view.members.map((member) => (
                <li key={member.personId} className="flex justify-between gap-3">
                  <span>{member.fullName}</span>
                  <span className="text-xs text-muted-foreground">{t(`memberRole.${member.role}`)}</span>
                </li>
              ))}
              {view.members.length === 0 ? <li className="text-sm text-muted-foreground">{t("none")}</li> : null}
            </ul>
          )}
        </div>
      </section>

      {view.opening.description || view.opening.requirements || view.opening.benefits ? (
        <section className="flex flex-col gap-4 rounded-xl border p-4 text-sm">
          {[
            ["description", view.opening.description],
            ["requirements", view.opening.requirements],
            ["benefits", view.opening.benefits],
          ]
            .filter(([, body]) => !!body)
            .map(([key, body]) => (
              <div key={key} className="flex flex-col gap-1">
                <h2 className="text-sm font-medium">{t(`form.${key}` as "form.description")}</h2>
                <RichText text={body} className="text-muted-foreground" />
              </div>
            ))}
        </section>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("candidates")} count={applications.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.candidate")}</TableHead>
              <TableHead kind="text">{t("columns.currentTitle")}</TableHead>
              <TableHead kind="select">{t("columns.source")}</TableHead>
              <TableHead kind="date">{t("columns.appliedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.length === 0 ? <TableEmpty>{t("noApplications")}</TableEmpty> : null}
            {byStage
              .filter((column) => column.rows.length > 0)
              .flatMap((column) => [
                <TableGroupRow key={`stage-${column.stage.id}`}>
                  {column.stage.name} ({column.rows.length})
                </TableGroupRow>,
                ...column.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-72 truncate">
                      <Link href={`/recruit/applications/${row.id}`} className="font-medium hover:underline">
                        {row.candidateName}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{row.currentTitle || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`source.${row.source}`)}</Badge>
                    </TableCell>
                    <TableCell>{format.dateTime(row.appliedAt, { dateStyle: "medium" })}</TableCell>
                  </TableRow>
                )),
              ])}
          </TableBody>
        </Table>
        {closed.length > 0 ? (
          <details className="group/closed border-t">
            <summary className="flex h-12 cursor-pointer list-none items-center px-3 text-sm text-muted-foreground transition-colors select-none hover:bg-muted/40 hover:text-foreground group-open/closed:text-foreground [&::-webkit-details-marker]:hidden">
              {t("applicationStatus.rejected")} / {t("applicationStatus.withdrawn")} ({closed.length})
            </summary>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="text">{t("columns.candidate")}</TableHead>
                    <TableHead kind="select">{t("columns.stage")}</TableHead>
                    <TableHead kind="status">{t("columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-72 truncate">
                        <Link href={`/recruit/applications/${row.id}`} className="hover:underline">
                          {row.candidateName}
                        </Link>
                      </TableCell>
                      <TableCell>{row.stageName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(`applicationStatus.${row.status}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        ) : null}
        {view.canEdit && candidates.length > 0 ? (
          <TableAddRow label={t("actions.addApplication")} open={applications.length === 0}>
            <AddApplicationForm
              openingId={openingId}
              candidates={candidates}
              canSetMoney={canSetRecruitMoney(user.principal, { entityId: view.opening.entityId, departmentId: view.opening.departmentId, teamId: view.opening.teamId })}
            />
          </TableAddRow>
        ) : null}
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
