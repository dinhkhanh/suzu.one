import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { canManageCycle, cycleProgress, listCycleParticipants, listReviewCycles, listReviewTemplates, nextCycleStatus } from "@/modules/performance/service";
import { FormStatusBadge, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AdvanceCycleForm, CycleForm, LaunchCycleForm, ReleaseCycleForm } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "Review cycles" };

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
  const progress = await cycleProgress(cycles.map((cycle) => cycle.id));
  const openId = typeof params.cycle === "string" ? params.cycle : null;
  const open = cycles.find((cycle) => cycle.id === openId) ?? null;
  const participants = open ? await listCycleParticipants(open.id) : [];
  const entityName = (entityId: string | null) => (entityId ? (entities.find((row) => row.id === entityId)?.shortName ?? "—") : t("cycle.wholeGroup"));
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("admin.description")}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("admin.cycles", { year })}</h2>
        {cycles.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.noCycles")}</p> : null}
        <ul className="flex flex-col gap-3">
          {cycles.map((cycle) => {
            const counts = progress.get(cycle.id) ?? { participants: 0, selfDone: 0, managerDone: 0, released: 0 };
            const next = nextCycleStatus(cycle.status as Parameters<typeof nextCycleStatus>[0]);
            return (
              <li key={cycle.id} className="flex flex-col gap-2 rounded-xl border p-3">
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
                  {/* Release everyone whose manager review is in. The ones it skips are reported. */}
                  {cycle.status === "calibration" || cycle.status === "active" ? <ReleaseCycleForm cycleId={cycle.id} /> : null}
                  {next ? <AdvanceCycleForm cycleId={cycle.id} to={next} label={t(`admin.advance.${next}`)} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {open ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t("admin.participants", { name: open.name })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {participants.map((line) => (
              <li key={line.participantId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Link href={`/performance/reviews/${line.participantId}`} className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline">
                  {line.personName}
                </Link>
                <span className="text-xs text-muted-foreground">{line.managerName ?? "—"}</span>
                <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                <FormStatusBadge status={line.managerStatus} label={t(`formStatus.${line.managerStatus ?? "none"}`)} />
                <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("admin.newCycle")}</h2>
        {templates.filter((template) => template.isActive).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.noTemplates")}</p>
        ) : (
          <CycleForm
            value={{ id: null, entityId: manageable[0]?.id ?? null, name: "", kind: "annual", year, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, templateId: "", selfDueOn: null, managerDueOn: null, peerDueOn: null, calibrationOn: null, releaseOn: null, peersEnabled: true, peerMin: 1, peerMax: 5, peerAnonymous: true }}
            entities={manageable.map((entity) => ({ id: entity.id, name: `${entity.code} · ${entity.shortName}` }))}
            templates={templates.filter((template) => template.isActive).map((template) => ({ id: template.id, name: template.name }))}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("admin.templates")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {templates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <span className="min-w-0 flex-1">{template.name}</span>
              <span className="text-xs text-muted-foreground">{t("admin.templateShape", { sections: template.sections.length, points: template.ratingScale.length })}</span>
              {!template.isActive ? <span className="text-xs text-muted-foreground">{t("admin.inactive")}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("admin.templateHint")}</p>
      </section>
    </div>
  );
}
