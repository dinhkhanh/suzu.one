// What the KPI screens read: the entry grid, the manager's dashboard and the owner's overview.
// Every function takes the viewer and returns only what the policy lets them see.
import "server-only";
import { listEntities, unitChoices } from "../platform/org/service";
import { kpiMonthScore, type KpiLineInput } from "./engine/kpi-score";
import { weightedAverageBp } from "./engine/progress";
import type { Confidence } from "./enums";
import { listGoals, type Viewer } from "./goals";
import { isMissing, listPeriods, listStoredScores, loadMonthLines, loadMonthLinesByEntity } from "./kpi-scores";
import { type DirectoryPerson, loadDirectory } from "./people";
import { canEnterActualsFor, overviewReach, readablePeople } from "./policy";
import { proposalsFor } from "./work-actuals";

const byName = (a: { fullName: string }, b: { fullName: string }) => a.fullName.localeCompare(b.fullName, "vi");
const CONFIDENCE_ORDER: Confidence[] = ["on_track", "at_risk", "off_track"];
const worst = (values: (Confidence | null)[]): Confidence | null => values.reduce<Confidence | null>((current, value) => (value && (!current || CONFIDENCE_ORDER.indexOf(value) > CONFIDENCE_ORDER.indexOf(current)) ? value : current), null);

// ── Entry grid ──────────────────────────────────────────────────────────────────────────────

/** `proposals`: assignment → the figure the work job proposed and nobody has decided yet (FR-PJM-62). */
export type EntryRow = { personId: string; fullName: string; entityId: string | null; closed: boolean; lines: KpiLineInput[]; proposals: Record<string, number> };

/** The people the viewer may enter actuals for (never themself), with the lines due in `month`. */
export async function getEntryGrid(viewer: Viewer, month: string): Promise<EntryRow[]> {
  const directory = await loadDirectory();
  const people = [...directory.values()].filter((person) => person.status !== "offboarded" && canEnterActualsFor(viewer.principal, person));
  const [lines, periods] = await Promise.all([loadMonthLines({ personIds: people.map((person) => person.personId) }, month), listPeriods({ month })]);
  const closed = new Set(periods.filter((period) => period.status === "closed").map((period) => period.entityId));
  const proposals = await proposalsFor([...lines.values()].flat());
  return people
    .filter((person) => lines.has(person.personId))
    .sort(byName)
    .map((person) => {
      const own = [...lines.get(person.personId)!].sort((a, b) => a.kpiCode.localeCompare(b.kpiCode));
      return { personId: person.personId, fullName: person.fullName, entityId: person.entityId ?? null, closed: !!person.entityId && closed.has(person.entityId), lines: own, proposals: Object.fromEntries(own.flatMap((line) => (proposals.has(line.assignmentId) ? [[line.assignmentId, proposals.get(line.assignmentId)!]] : []))) };
    });
}

// ── Manager dashboard ───────────────────────────────────────────────────────────────────────

export type TeamRow = {
  personId: string;
  fullName: string;
  canEnter: boolean;
  kpi: { state: "closed" | "open"; scoreBp: number | null; lines: number; missing: number } | null;
  okr: { goals: number; progressBp: number | null; confidence: Confidence | null; stale: number } | null;
};

/** Everyone whose performance the viewer reads, other than themself: the line below them, or their role's scope. */
export async function getTeamDashboard(viewer: Viewer, month: string, now: Date = new Date()): Promise<TeamRow[]> {
  const directory = await loadDirectory();
  const readable = readablePeople(viewer.principal, directory.values());
  readable.delete(viewer.personId);
  const people = [...readable].map((id) => directory.get(id)!).filter((person) => person.status !== "offboarded");
  const personIds = people.map((person) => person.personId);
  const [lines, stored, goals] = await Promise.all([loadMonthLines({ personIds }, month), listStoredScores({ month, personIds }), listGoals(viewer, { year: Number(month.slice(0, 4)) }, now)]);
  const storedOf = new Map(stored.map((score) => [score.personId, score]));
  return people.sort(byName).map((person) => {
    const own = goals.filter((goal) => goal.level === "individual" && goal.personId === person.personId && (goal.status === "active" || goal.status === "closed"));
    const items = lines.get(person.personId) ?? [];
    const score = storedOf.get(person.personId);
    return {
      personId: person.personId,
      fullName: person.fullName,
      canEnter: canEnterActualsFor(viewer.principal, person),
      kpi: score ? { state: "closed", scoreBp: score.scoreBp, lines: items.length, missing: 0 } : items.length > 0 ? { state: "open", scoreBp: kpiMonthScore(month, items, { missingAs: "excluded" }).scoreBp, lines: items.length, missing: items.filter(isMissing).length } : null,
      okr: own.length > 0 ? { goals: own.length, progressBp: weightedAverageBp(own.map((goal) => ({ weight: goal.weight, progressBp: goal.progress.progressBp }))), confidence: worst(own.map((goal) => goal.progress.confidence)), stale: own.reduce((sum, goal) => sum + (goal.status === "active" ? goal.keyResults.filter((keyResult) => keyResult.stale).length : 0), 0) } : null,
    };
  });
}

// ── Owner dashboard ─────────────────────────────────────────────────────────────────────────

export type Spread = { people: number; averageBp: number | null; minBp: number | null; medianBp: number | null; maxBp: number | null };
export type OverviewEntity = {
  entityId: string;
  code: string;
  name: string;
  /** Status per month of the year; a month without a row is open. */
  months: { month: string; status: "closed" | "open"; overridden: boolean }[];
  state: "closed" | "open";
  missing: number;
  spread: Spread;
  departments: { departmentId: string | null; name: string | null; spread: Spread }[];
};
export type Overview = { month: string; entities: OverviewEntity[]; goals: { id: string; level: "group" | "entity"; unitName: string | null; title: string; periodKey: string; progressBp: number | null; confidence: Confidence | null }[] };

export function spreadOf(scores: readonly (number | null)[]): Spread {
  const values = scores.filter((score): score is number => score !== null).sort((a, b) => a - b);
  if (values.length === 0) return { people: 0, averageBp: null, minBp: null, medianBp: null, maxBp: null };
  const middle = values.length / 2;
  return { people: values.length, averageBp: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), minBp: values[0], medianBp: values.length % 2 === 1 ? values[Math.floor(middle)] : Math.round((values[middle - 1] + values[middle]) / 2), maxBp: values[values.length - 1] };
}

/** Per entity and department in the viewer's reach: who is scored, how the scores spread, which months are closed. Null: no reach. */
export async function getOverview(viewer: Viewer, month: string, months: readonly string[], now: Date = new Date()): Promise<Overview | null> {
  const reach = overviewReach(viewer.principal);
  if (!reach.all && reach.entityIds.length === 0) return null;
  const year = Number(month.slice(0, 4));
  const goalsLoading = listGoals(viewer, { year }, now);
  // Awaited below; a failure of the batch in between must not leave this rejection unhandled.
  goalsLoading.catch(() => undefined);
  const [entities, departments, directory] = await Promise.all([listEntities(), unitChoices(), loadDirectory()]);
  const visible = entities.filter((entity) => entity.isActive && (reach.all || reach.entityIds.includes(entity.id)));
  const entityIds = visible.map((entity) => entity.id);
  const [periods, stored, goals] = await Promise.all([listPeriods({ year, entityIds }), listStoredScores({ month, entityIds }), goalsLoading]);
  const departmentName = new Map(departments.map((department) => [department.id, department.name]));
  const isClosed = (entityId: string) => periods.some((period) => period.entityId === entityId && period.month === month && period.status === "closed");
  // The open entities' lines, all at once rather than one entity after another.
  const openLines = await loadMonthLinesByEntity(visible.filter((entity) => !isClosed(entity.id)).map((entity) => entity.id), month);

  const result: OverviewEntity[] = [];
  for (const entity of visible) {
    const closed = isClosed(entity.id);
    // Closed: the stored scores. Open: the provisional figures over what has been entered so far.
    const scores = new Map<string, number | null>();
    let missing = 0;
    if (closed) for (const score of stored.filter((row) => row.entityId === entity.id)) scores.set(score.personId, score.scoreBp);
    else {
      for (const [personId, items] of openLines.get(entity.id)!) {
        scores.set(personId, kpiMonthScore(month, items, { missingAs: "excluded" }).scoreBp);
        missing += items.filter(isMissing).length;
      }
    }
    const byDepartment = new Map<string | null, (number | null)[]>();
    for (const [personId, score] of scores) {
      const person: DirectoryPerson | undefined = directory.get(personId);
      const key = person?.departmentId ?? null;
      byDepartment.set(key, [...(byDepartment.get(key) ?? []), score]);
    }
    result.push({
      entityId: entity.id,
      code: entity.code,
      name: entity.shortName,
      months: months.map((key) => {
        const period = periods.find((row) => row.entityId === entity.id && row.month === key);
        return { month: key, status: period?.status === "closed" ? "closed" : "open", overridden: period?.status === "closed" && !!period.overrideReason };
      }),
      state: closed ? "closed" : "open",
      missing,
      spread: spreadOf([...scores.values()]),
      departments: [...byDepartment.entries()].map(([departmentId, values]) => ({ departmentId, name: departmentId ? (departmentName.get(departmentId) ?? null) : null, spread: spreadOf(values) })).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "vi")),
    });
  }
  const top = goals.filter((goal) => (goal.status === "active" || goal.status === "closed") && (goal.level === "group" || (goal.level === "entity" && !!goal.entityId && entityIds.includes(goal.entityId))));
  return { month, entities: result, goals: top.map((goal) => ({ id: goal.id, level: goal.level as "group" | "entity", unitName: goal.unitName, title: goal.title, periodKey: goal.periodKey, progressBp: goal.progress.progressBp, confidence: goal.progress.confidence })) };
}
