// Delivery (FR-PJM-50..57), the parts that are rules rather than storage. Pure: the service loads
// the chains, the people and the publish log; these functions say which chain a task runs through,
// who reviews a stage, where a decision sends the version, whether a post is late, and whether a
// pin is well placed.
import { toSearchKey } from "@/lib/text";

// ── Review chains (FR-PJM-50) ───────────────────────────────────────────────────────────────

/** Every decision a stage can take. "Approved with changes" passes the stage; the comment says what to touch up. */
export const STAGE_DECISIONS = ["approved", "approved_with_changes", "changes_required"] as const;
export type StageDecision = (typeof STAGE_DECISIONS)[number];

/** Who reviews a stage. `person:<id>` names one person; `client` is recorded by the account side. */
export const REVIEWER_RULES = ["task_reviewer", "project_lead", "team_lead", "account_manager", "client"] as const;
export type ReviewerRuleKind = (typeof REVIEWER_RULES)[number] | "person";
export type ReviewerRule = { kind: Exclude<ReviewerRuleKind, "person"> } | { kind: "person"; personId: string };

export const MAX_CHAIN_STAGES = 8;
/** A stage's due time: up to a month. */
export const MAX_STAGE_DUE_HOURS = 24 * 31;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReviewerRule(rule: string): ReviewerRule | null {
  if (rule.startsWith("person:")) {
    const personId = rule.slice("person:".length);
    return UUID.test(personId) ? { kind: "person", personId } : null;
  }
  return (REVIEWER_RULES as readonly string[]).includes(rule) ? { kind: rule as Exclude<ReviewerRuleKind, "person"> } : null;
}

export const isClientStage = (stage: { reviewer: string } | undefined | null): boolean => stage?.reviewer === "client";

export type ChainStage = { key: string; name: string; reviewer: string; dueHours: number | null };

/** What is wrong with a chain's stages, as message keys; empty = it can be saved. */
export function chainProblems(stages: readonly ChainStage[]): string[] {
  const problems = new Set<string>();
  if (stages.length === 0) problems.add("chain_needs_stage");
  if (stages.length > MAX_CHAIN_STAGES) problems.add("chain_too_many_stages");
  for (const stage of stages) {
    if (!stage.name.trim()) problems.add("chain_stage_name_required");
    if (!parseReviewerRule(stage.reviewer)) problems.add("chain_reviewer_invalid");
    if (stage.dueHours !== null && (!Number.isInteger(stage.dueHours) || stage.dueHours < 1 || stage.dueHours > MAX_STAGE_DUE_HOURS)) problems.add("chain_due_invalid");
  }
  // The client decides once, at the end: after the client has approved, the version is frozen.
  const clientAt = stages.findIndex((stage) => isClientStage(stage));
  if (clientAt >= 0 && clientAt !== stages.length - 1) problems.add("chain_client_not_last");
  return [...problems];
}

export type ChainDef = { id: string; teamId: string | null; projectId: string | null; contentFormat: string | null; isActive: boolean; stageCount: number; createdAt: Date };

/**
 * The chain a task's deliverable runs through: its project's before its team's, and within each a
 * chain for the task's content format before one for every format. Ties go to the oldest chain, so
 * adding a second one never silently changes where running work goes. null = the single-step review.
 */
export function chainFor<Chain extends ChainDef>(chains: readonly Chain[], task: { teamId: string; projectId: string | null; contentFormat: string | null }): Chain | null {
  const rank = (chain: Chain): number | null => {
    if (!chain.isActive || chain.stageCount === 0) return null;
    if (chain.contentFormat && chain.contentFormat !== task.contentFormat) return null;
    const specific = chain.contentFormat ? 0 : 1;
    if (chain.projectId) return chain.projectId === task.projectId ? specific : null;
    return chain.teamId === task.teamId ? 2 + specific : null;
  };
  let best: { chain: Chain; rank: number } | null = null;
  for (const chain of chains) {
    const value = rank(chain);
    if (value === null) continue;
    if (!best || value < best.rank || (value === best.rank && chain.createdAt < best.chain.createdAt)) best = { chain, rank: value };
  }
  return best?.chain ?? null;
}

/** Who could review, from the task's surroundings. `active` = people who have not left. */
export type ReviewerFacts = {
  taskReviewerId: string | null;
  projectLeadIds: readonly string[];
  teamLeadIds: readonly string[];
  accountManagerIds: readonly string[];
  active: ReadonlySet<string>;
};

/**
 * The stage's reviewer: the first person the rule names who is active and did not hand the work
 * in; when the rule names nobody usable, the default reviewer order (the task's reviewer, the
 * project's lead, the team's leads) — a missing account manager must not stall the version.
 */
export function resolveStageReviewer(rule: string, facts: ReviewerFacts, submitterId: string): string | null {
  const parsed = parseReviewerRule(rule);
  const named: (string | null)[] = !parsed
    ? []
    : parsed.kind === "person"
      ? [parsed.personId]
      : parsed.kind === "task_reviewer"
        ? [facts.taskReviewerId]
        : parsed.kind === "project_lead"
          ? [...facts.projectLeadIds]
          : parsed.kind === "team_lead"
            ? [...facts.teamLeadIds]
            : [...facts.accountManagerIds];
  const fallback = [facts.taskReviewerId, ...facts.projectLeadIds, ...facts.teamLeadIds];
  return [...named, ...fallback].find((id): id is string => !!id && id !== submitterId && facts.active.has(id)) ?? null;
}

export type StageOutcome = { kind: "next"; stageIndex: number } | { kind: "approved" } | { kind: "changes" };

/** Where a decision at stage `index` of `stageCount` sends the version. */
export function stageOutcome(stageCount: number, index: number, decision: StageDecision): StageOutcome {
  if (decision === "changes_required") return { kind: "changes" };
  return index + 1 < stageCount ? { kind: "next", stageIndex: index + 1 } : { kind: "approved" };
}

/** A stage's due time from when it started; null = no due time. */
export const stageDueAt = (startedAt: Date, dueHours: number | null | undefined): Date | null => (dueHours ? new Date(startedAt.getTime() + dueHours * 3_600_000) : null);

// ── Client decisions (FR-PJM-51) ────────────────────────────────────────────────────────────

export const CLIENT_CHANNELS = ["email", "zalo", "meeting", "call", "other"] as const;
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];

/** Client approval (with or without small changes) freezes the version; a change after it is a new version. */
export const freezesVersion = (decision: StageDecision): boolean => decision !== "changes_required";

export const isHttpsUrl = (value: string | null | undefined): boolean => {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

// ── Visual feedback (FR-PJM-52) ─────────────────────────────────────────────────────────────

export type MediaKind = "image" | "video";
export const mediaKindOf = (contentType: string | null | undefined): MediaKind | null => (contentType?.startsWith("image/") ? "image" : contentType?.startsWith("video/") ? "video" : null);

/** A video is at most a few hours; anything beyond is a typing mistake. */
export const MAX_TIMECODE_MS = 6 * 3_600_000;

/** A pin is a point on an image (x, y in 0..1) or a moment of a video — never both, never neither. null = fine. */
export function pinProblem(pin: { x: number | null; y: number | null; timecodeMs: number | null }, media: MediaKind | null): string | null {
  if (!media) return "pin_not_media";
  const inUnit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (media === "image") {
    if (pin.timecodeMs !== null) return "pin_position_invalid";
    return pin.x !== null && pin.y !== null && inUnit(pin.x) && inUnit(pin.y) ? null : "pin_position_invalid";
  }
  if (pin.x !== null || pin.y !== null) return "pin_position_invalid";
  return pin.timecodeMs !== null && Number.isInteger(pin.timecodeMs) && pin.timecodeMs >= 0 && pin.timecodeMs <= MAX_TIMECODE_MS ? null : "pin_timecode_invalid";
}

/** "1:05" or "1:02:03" for a timecode. */
export function formatTimecode(ms: number): string {
  const total = Math.floor(ms / 1000);
  const [hours, minutes, seconds] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// ── Publish log (FR-PJM-54) ─────────────────────────────────────────────────────────────────

/**
 * A workflow state that means "it is out": the content preset's "Published" and the names teams
 * give it. States are free text per team (FR-WRK-03), so the name decides — spelled any case, with
 * or without Vietnamese accents.
 */
const PUBLISH_STATE_NAMES = new Set(["published", "posted", "live", "da dang", "da dang bai", "dang bai", "da xuat ban", "da len song", "da phat song"]);
export const isPublishStateName = (name: string): boolean => PUBLISH_STATE_NAMES.has(toSearchKey(name));

export type PublishFlag = "published" | "late" | "planned" | "unscheduled" | "cancelled";

/** How a publish row looks on the calendar: late = its planned time has passed and it is not out. */
export function publishFlag(publish: { status: string; plannedAt: Date | null }, now: Date): PublishFlag {
  if (publish.status === "published") return "published";
  if (publish.status === "cancelled") return "cancelled";
  if (!publish.plannedAt) return "unscheduled";
  return publish.plannedAt.getTime() < now.getTime() ? "late" : "planned";
}

/**
 * A content task (it has a channel) that is due in the past or today and has no publish row at
 * all — neither planned nor published — is "missing" on the calendar. Closed-and-cancelled work is not.
 */
export function isPublishMissing(task: { channel: string | null; dueDate: string | null; status: string }, publishCount: number, today: string): boolean {
  return !!task.channel && task.status !== "cancelled" && !!task.dueDate && task.dueDate <= today && publishCount === 0;
}

/** Vietnam wall-clock "YYYY-MM-DDTHH:mm" (what a datetime-local field sends) as an instant. Vietnam has no daylight saving. */
export function fromVietnamLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The other way, for a datetime-local field's value. */
export const toVietnamLocal = (date: Date): string => new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 16);

// ── Results (FR-PJM-57) ─────────────────────────────────────────────────────────────────────

export const RESULT_METRICS = ["reach", "views", "engagement", "clicks", "spendVnd"] as const;
export type ResultMetric = (typeof RESULT_METRICS)[number];
export type Metrics = Partial<Record<ResultMetric, number>>;

/** Only whole, non-negative numbers are kept; money is integer VND. null = nothing was given. */
export function cleanMetrics(input: Partial<Record<ResultMetric, number | null | undefined>>): Metrics | null {
  const metrics: Metrics = {};
  for (const key of RESULT_METRICS) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) return null;
    metrics[key] = value;
  }
  return Object.keys(metrics).length ? metrics : null;
}

/**
 * What a post has reached so far. Each row is a reading as of its date (the platforms report running
 * totals), so the latest reading of each figure counts — adding readings up would count twice.
 */
export function latestMetrics(rows: readonly { recordedOn: string; metrics: Metrics }[]): Metrics {
  const latest: Metrics = {};
  const seenOn: Partial<Record<ResultMetric, string>> = {};
  for (const row of rows)
    for (const key of RESULT_METRICS) {
      const value = row.metrics[key];
      if (value === undefined || (seenOn[key] !== undefined && seenOn[key]! > row.recordedOn)) continue;
      latest[key] = value;
      seenOn[key] = row.recordedOn;
    }
  return latest;
}
