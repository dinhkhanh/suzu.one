import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { canManageCycle, cycleProgress, listCycleParticipants, listReviewCycles, listReviewTemplates, nextCycleStatus } from "@/modules/performance/service";
import { FormStatusBadge, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AdvanceCycleForm, CycleForm, LaunchCycleForm, ReleaseCycleForm } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewCycles");

/**
 * HR's review cycles (FR-PRF-03): build one, launch it — which freezes the form and snapshots
 * every participant's manager — then carry it through calibration to release and close.
 * A cycle covering the whole group needs a group-wide grant; an entity's HR sees only their own.
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
  const [progress, participants] = await Promise.all([cycleProgress(cycles.map((cycle) => cycle.id)), open ? listCycleParticipants(open.id) : []]);
  const entityName = (entityId: string | null) => (entityId ? (entities.find((row) => row.id === entityId)?.shortName ?? "—") : t("cycle.wholeGroup"));
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("admin.description")}</p>

      <TableCard>
        <TableCardHeader title={t("admin.cycles", { year })} count={cycles.length || null} />
        <List>
          {cycles.length === 0 ? <ListEmpty>{t("admin.noCycles")}</ListEmpty> : null}
          {cycles.map((cycle) => {
            const counts = progress.get(cycle.id) ?? { participants: 0, selfDone: 0, managerDone: 0, released: 0 };
            const next = nextCycleStatus(cycle.status as Parameters<typeof nextCycleStatus>[0]);
            return (
              <ListItem key={cycle.id} className="flex-col items-stretch gap-2">
                <header className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-medium">{cycle.name}</h3>
                  <span className="text-xs text-muted-foreground">{`${entityName(cycle.entityId)} · ${t(`cycle.kinds.${cycle.kind}`)}`}</span>
                  <FormStatusBadge status={cycle.status === "draft" ? "draft" : "submitted"} label={t(`cycleStatus.${cycle.status}`)} />
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
                {cycle.status !== "draft" ? <p className="text-xs text-muted-foreground tabular-nums">{t("admin.progress", { participants: counts.participants, self: counts.selfDone, manager: counts.managerDone, released: counts.released })}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  {cycle.status === "draft" ? <LaunchCycleForm cycleId={cycle.id} /> : null}
                  {/* Release everyone whose manager review is in — from the calibration stage on (PRF-02). The ones it skips are reported. */}
                  {cycle.status === "calibration" ? <ReleaseCycleForm cycleId={cycle.id} /> : null}
                  {next ? <AdvanceCycleForm cycleId={cycle.id} to={next} label={t(`admin.advance.${next}`)} /> : null}
                </div>
              </ListItem>
            );
          })}
        </List>
        <TableAddRow label={t("admin.newCycle")} open={cycles.length === 0}>
          {templates.filter((template) => template.isActive).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.noTemplates")}</p>
          ) : (
            <CycleForm
              value={{ id: null, entityId: manageable[0]?.id ?? null, name: "", kind: "annual", year, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, templateId: "", selfDueOn: null, managerDueOn: null, peerDueOn: null, calibrationOn: null, releaseOn: null, peersEnabled: true, peerMin: 1, peerMax: 5, peerAnonymous: true }}
              entities={manageable.map((entity) => ({ id: entity.id, name: `${entity.code} · ${entity.shortName}` }))}
              templates={templates.filter((template) => template.isActive).map((template) => ({ id: template.id, name: template.name }))}
            />
          )}
        </TableAddRow>
      </TableCard>

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
                <TableHead kind="status">{t("columns.stage")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.length === 0 ? <TableEmpty>{t("admin.noParticipants")}</TableEmpty> : null}
              {participants.map((line) => (
                <TableRow key={line.participantId}>
                  <TableCell>
                    <Link href={`/performance/reviews/${line.participantId}`} className="font-medium underline-offset-4 hover:underline">
                      {line.personName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.managerName ? <RecordLink kind="person" id={line.managerPersonId}>{line.managerName}</RecordLink> : "—"}</TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.managerStatus} label={t(`formStatus.${line.managerStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("admin.templates")} count={templates.length || null} description={t("admin.templateHint")} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.template")}</TableHead>
              <TableHead kind="number">{t("columns.questions")}</TableHead>
              <TableHead kind="number">{t("columns.scale")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? <TableEmpty>{t("admin.noTemplates")}</TableEmpty> : null}
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell kind="number">{template.sections.length}</TableCell>
                <TableCell kind="number">{template.ratingScale.length}</TableCell>
                <TableCell>{!template.isActive ? <Badge variant="outline">{t("admin.inactive")}</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
