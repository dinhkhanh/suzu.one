import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import {
  canManageCycle,
  cycleProgress,
  listCycleParticipants,
  listReviewCycles,
  listReviewTemplates,
  loadDirectory,
  nextCycleStatus,
  releasable,
  type ReviewCycleKind,
  type ReviewCycleRow,
  type ReviewCycleStatus,
} from "@/modules/performance/service";
import { FormStatusBadge, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AddParticipantForm, AdvanceCycleForm, CycleForm, type CycleFormValue, LaunchCycleForm, ReleaseCycleForm } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewCycles");

const formValueOf = (cycle: ReviewCycleRow): CycleFormValue => ({
  id: cycle.id,
  entityId: cycle.entityId,
  name: cycle.name,
  kind: cycle.kind as ReviewCycleKind,
  year: cycle.year,
  periodStart: cycle.periodStart,
  periodEnd: cycle.periodEnd,
  templateId: cycle.templateId ?? "",
  selfDueOn: cycle.selfDueOn,
  managerDueOn: cycle.managerDueOn,
  peerDueOn: cycle.peerDueOn,
  calibrationOn: cycle.calibrationOn,
  releaseOn: cycle.releaseOn,
  peersEnabled: cycle.peersEnabled,
  peerMin: cycle.peerMin,
  peerMax: cycle.peerMax,
  peerAnonymous: cycle.peerAnonymous,
  signOffRequired: cycle.signOffRequired,
  isRolling: cycle.isRolling,
});

/**
 * HR's review cycles (FR-PRF-03): build one, launch it — which freezes the form, snapshots every
 * participant's manager and tells everybody their review is open — then carry it through
 * calibration to release and close. A rolling probation cycle is launched once and fills itself
 * as probations near their end. A cycle covering the whole group needs a group-wide grant; an
 * entity's HR sees only their own.
 */
export default async function ReviewCyclesPage({ searchParams }: PageProps<"/performance/admin/cycles">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = typeof params.year === "string" && /^\d{4}$/.test(params.year) ? Number(params.year) : Number(today.slice(0, 4));
  const [entities, templates, allCycles, t, format] = await Promise.all([listEntities(), listReviewTemplates(), listReviewCycles({ year }), getTranslations("performance.reviews"), getFormatter()]);

  const manageable = entities.filter((entity) => entity.isActive && canManageCycle(user.principal, entity.id));
  const groupWide = canManageCycle(user.principal, null);
  if (manageable.length === 0 && !groupWide) notFound();

  const cycles = allCycles.filter((cycle) => canManageCycle(user.principal, cycle.entityId));
  const openId = typeof params.cycle === "string" ? params.cycle : null;
  const open = cycles.find((cycle) => cycle.id === openId) ?? null;
  const [progress, participants, directory] = await Promise.all([cycleProgress(cycles.map((cycle) => cycle.id)), open ? listCycleParticipants(open.id) : [], open ? loadDirectory() : null]);
  const entityName = (entityId: string | null) => (entityId ? (entities.find((row) => row.id === entityId)?.shortName ?? "—") : t("cycle.wholeGroup"));
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });
  const activeTemplates = templates.filter((template) => template.isActive).map((template) => ({ id: template.id, name: template.name, kinds: template.kinds }));
  const entityOptions = manageable.map((entity) => ({ id: entity.id, name: `${entity.code} · ${entity.shortName}` }));

  // Who may still be put into the open cycle: active people of its entity who are not in it yet.
  const inCycle = new Set(participants.map((line) => line.personId));
  const candidates =
    open && directory && (open.status === "draft" || open.status === "active")
      ? [...directory.values()]
          .filter((row) => row.status === "active" && !inCycle.has(row.personId) && (open.entityId === null || row.entityId === open.entityId))
          .map((row) => ({ id: row.personId, name: row.fullName }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("admin.description")}</p>

      <TableCard>
        <TableCardHeader title={t("admin.cycles", { year })} count={cycles.length || null} />
        <List>
          {cycles.length === 0 ? <ListEmpty>{t("admin.noCycles")}</ListEmpty> : null}
          {cycles.map((cycle) => {
            const counts = progress.get(cycle.id) ?? { participants: 0, selfDone: 0, managerDone: 0, released: 0 };
            const status = cycle.status as ReviewCycleStatus;
            const next = nextCycleStatus(status, cycle.isRolling);
            return (
              <ListItem key={cycle.id} className="flex-col items-stretch gap-2">
                <header className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-medium">{cycle.name}</h3>
                  <span className="text-xs text-muted-foreground">{`${entityName(cycle.entityId)} · ${t(`cycle.kinds.${cycle.kind}`)}`}</span>
                  <FormStatusBadge status={cycle.status === "draft" ? "draft" : "submitted"} label={t(`cycleStatus.${cycle.status}`)} />
                  {cycle.isRolling ? <Badge variant="info">{t("cycle.rolling")}</Badge> : null}
                  {cycle.signOffRequired ? <Badge variant="outline">{t("cycle.signOffBadge")}</Badge> : null}
                  <Link href={`/performance/admin/cycles?year=${year}&cycle=${cycle.id}`} className="ml-auto text-xs underline underline-offset-4">
                    {t("admin.open")}
                  </Link>
                </header>
                <Timeline
                  dates={[
                    { key: "selfDueOn", on: cycle.selfDueOn },
                    { key: "managerDueOn", on: cycle.managerDueOn },
                    { key: "calibrationOn", on: cycle.calibrationOn },
                    { key: "releaseOn", on: cycle.releaseOn },
                  ]}
                  labels={{ t, formatDate }}
                />
                {cycle.status !== "draft" ? (
                  <p className="text-xs text-muted-foreground tabular-nums">{t("admin.progress", { participants: counts.participants, self: counts.selfDone, manager: counts.managerDone, released: counts.released })}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  {cycle.status === "draft" ? <LaunchCycleForm cycleId={cycle.id} /> : null}
                  {/* Release everyone whose manager review is in — from the calibration stage on (PRF-02), or
                      any time in a rolling probation cycle. The ones it skips are reported. */}
                  {cycle.status !== "draft" && cycle.status !== "closed" && releasable({ status, rolling: cycle.isRolling }) && counts.released < counts.participants ? <ReleaseCycleForm cycleId={cycle.id} /> : null}
                  {next ? <AdvanceCycleForm cycleId={cycle.id} to={next} label={t(`admin.advance.${next}`)} /> : null}
                </div>
              </ListItem>
            );
          })}
        </List>
        <TableAddRow label={t("admin.newCycle")} open={cycles.length === 0}>
          {activeTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.noTemplates")}{" "}
              <Link href="/performance/admin/templates" className="underline underline-offset-4">
                {t("templates.title")}
              </Link>
            </p>
          ) : (
            <CycleForm
              value={{
                id: null,
                entityId: manageable[0]?.id ?? null,
                name: "",
                kind: "annual",
                year,
                periodStart: `${year}-01-01`,
                periodEnd: `${year}-12-31`,
                templateId: "",
                selfDueOn: null,
                managerDueOn: null,
                peerDueOn: null,
                calibrationOn: null,
                releaseOn: null,
                peersEnabled: true,
                peerMin: 1,
                peerMax: 5,
                peerAnonymous: true,
                signOffRequired: false,
                isRolling: false,
              }}
              entities={entityOptions}
              templates={activeTemplates}
              groupWide={groupWide}
            />
          )}
        </TableAddRow>
      </TableCard>

      {open?.status === "draft" ? (
        <TableCard>
          <TableCardHeader title={t("admin.editCycle", { name: open.name })} description={t("admin.editHint")} />
          <div className="p-4">
            <CycleForm value={formValueOf(open)} entities={entityOptions} templates={activeTemplates} groupWide={groupWide} />
          </div>
        </TableCard>
      ) : null}

      {open ? (
        <TableCard>
          <TableCardHeader title={t("admin.participants", { name: open.name })} count={participants.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("columns.person")}</TableHead>
                <TableHead kind="person">{t("owed.managerLabel")}</TableHead>
                <TableHead kind="status">{t("form.kind.self")}</TableHead>
                <TableHead kind="status">{t("form.kind.manager")}</TableHead>
                <TableHead kind="date">{t("timeline.selfDueOn")}</TableHead>
                <TableHead kind="date">{t("timeline.managerDueOn")}</TableHead>
                <TableHead kind="status">{t("columns.stage")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.length === 0 ? <TableEmpty>{open.isRolling ? t("admin.noParticipantsRolling") : t("admin.noParticipants")}</TableEmpty> : null}
              {participants.map((line) => (
                <TableRow key={line.participantId}>
                  <TableCell>
                    <Link href={`/performance/reviews/${line.participantId}`} className="font-medium underline-offset-4 hover:underline">
                      {line.personName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.managerName ? (
                      <RecordLink kind="person" id={line.managerPersonId}>
                        {line.managerName}
                      </RecordLink>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.managerStatus} label={t(`formStatus.${line.managerStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell kind="date" className={line.selfDueOn && line.selfDueOn < today && line.selfStatus !== "submitted" ? "text-warning" : "text-muted-foreground"}>
                    {line.selfDueOn ? formatDate(line.selfDueOn) : "—"}
                  </TableCell>
                  <TableCell kind="date" className={line.managerDueOn && line.managerDueOn < today && line.managerStatus !== "submitted" ? "text-warning" : "text-muted-foreground"}>
                    {line.managerDueOn ? formatDate(line.managerDueOn) : "—"}
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {open.status === "draft" || open.status === "active" ? (
            <TableAddRow label={t("admin.add")}>
              <AddParticipantForm cycleId={open.id} candidates={candidates} needsDates={open.isRolling} />
            </TableAddRow>
          ) : null}
        </TableCard>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <Link href="/performance/admin/templates" className="underline underline-offset-4">
          {t("templates.manage")}
        </Link>
      </p>
    </div>
  );
}
