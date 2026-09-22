// Recruitment's use-cases (FR-REC-01, 02, 04) and the only entry point other modules use.
//
// Every list here is filtered in the database, not after it: `openingScope` turns "whoever runs
// recruitment where it sits, or is on its hiring team" into a single WHERE clause, and every query
// that returns openings, applications or candidates goes through it. A list that filters in
// JavaScript is a list that leaks the moment somebody adds a `count`.
import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, exists, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listFileNames } from "@/modules/platform/files/service";
import { listEntities, listOrgUnits } from "@/modules/platform/org/service";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { toSearchKey } from "@/lib/text";
import {
  APPLICATION_CLOSED,
  type ApplicationEventType,
  type ApplicationStatus,
  type CandidateSource,
  DEFAULT_RETENTION_MONTHS,
  type EmploymentType,
  type OpeningQuestion,
  type OpeningStatus,
  type RejectionReason,
  type WorkMode,
} from "./enums";
import { type CandidateLike, type DuplicateMatch, isCertainDuplicate, normaliseEmail, normalisePhone, probeFor, rankDuplicates } from "./engine/duplicates";
import { canBrowseCandidates, canReadRecruitMoney, canRunRecruitment, canViewOpening, type OpeningTarget } from "./policy";

export * from "./enums";
export * from "./engine/duplicates";
export {
  canActOnApplication,
  canBrowseCandidates,
  canEditOpening,
  canFileHiringRequest,
  canManageCandidates,
  canManagePipelines,
  canOpenCandidateFile,
  canOpenFromHiringRequest,
  canReadRecruitMoney,
  canRunRecruitment,
  canSetRecruitMoney,
  canViewHiringRequest,
  canViewOpening,
  type OpeningTarget,
} from "./policy";

type Executor = Tx | ReturnType<typeof db>;

export type PipelineRow = typeof schema.recruitPipeline.$inferSelect;
export type PipelineStageRow = typeof schema.recruitPipelineStage.$inferSelect;
export type OpeningRow = typeof schema.jobOpening.$inferSelect;
export type CandidateRow = typeof schema.candidate.$inferSelect;
export type ApplicationRow = typeof schema.jobApplication.$inferSelect;
export type HiringRequestRow = typeof schema.hiringRequest.$inferSelect;

const now = () => new Date();

export const inTransaction = <T>(work: (tx: Tx) => Promise<T>): Promise<T> => db().transaction(work);

// ── Identifiers ─────────────────────────────────────────────────────────────────────────────

/**
 * What the public careers URL carries. 128 bits of randomness, so an opening cannot be found by
 * walking the URL space, and no internal id is ever exposed. It identifies; it does not admit —
 * `findOpeningBySlug` still checks the opening is published.
 */
export const newPublicSlug = (): string => randomBytes(16).toString("base64url");

/**
 * The next code for an entity in a year: SZM-2026-003. Counted from the codes on the books rather
 * than a sequence, so an entity that starts mid-year keeps its own numbering.
 */
export async function nextOpeningCode(executor: Executor, entityCode: string, year: number): Promise<string> {
  const prefix = `${entityCode}-${year}-`;
  const rows = await executor
    .select({ code: schema.jobOpening.code })
    .from(schema.jobOpening)
    .where(sql`${schema.jobOpening.code} like ${prefix + "%"}`);
  const highest = rows.reduce((top, row) => {
    const tail = row.code.slice(prefix.length);
    return /^\d+$/.test(tail) ? Math.max(top, Number(tail)) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

// ── Pipelines ───────────────────────────────────────────────────────────────────────────────

// Pipelines and their stages are configuration (a few rows): cached together, read from the
// transaction when one is passed, and cleared by `savePipeline` once it has committed.
const PIPELINES_CACHE = "recruit:pipelines";
const PIPELINES_TTL = 60 * 60;
type PipelineTables = { pipelines: PipelineRow[]; stages: PipelineStageRow[] };

async function readPipelineTables(executor: Executor): Promise<PipelineTables> {
  const [pipelines, stages] = await Promise.all([
    executor.select().from(schema.recruitPipeline).orderBy(desc(schema.recruitPipeline.isDefault), asc(schema.recruitPipeline.name)),
    executor.select().from(schema.recruitPipelineStage).orderBy(asc(schema.recruitPipelineStage.sortOrder)),
  ]);
  return { pipelines, stages };
}

const pipelineTables = (executor?: Executor): Promise<PipelineTables> => (executor ? readPipelineTables(executor) : cached(PIPELINES_CACHE, PIPELINES_TTL, () => readPipelineTables(db())));

export async function listPipelines(executor?: Executor): Promise<(PipelineRow & { stages: PipelineStageRow[] })[]> {
  const { pipelines, stages } = await pipelineTables(executor);
  return pipelines.map((pipeline) => ({ ...pipeline, stages: stages.filter((stage) => stage.pipelineId === pipeline.id) }));
}

export async function stagesOf(pipelineId: string, executor?: Executor): Promise<PipelineStageRow[]> {
  return (await pipelineTables(executor)).stages.filter((stage) => stage.pipelineId === pipelineId);
}

/** Where a new application starts: the first stage of the opening's pipeline. */
export async function firstStageOf(pipelineId: string, executor?: Executor): Promise<PipelineStageRow> {
  const [stage] = await stagesOf(pipelineId, executor);
  if (!stage) throw new ActionError("recruit_pipeline_empty");
  return stage;
}

export async function findPipeline(pipelineId: string, executor?: Executor): Promise<PipelineRow | undefined> {
  return (await pipelineTables(executor)).pipelines.find((row) => row.id === pipelineId);
}

export type PipelineInput = { code: string; name: string; nameEn: string | null; description: string | null; isDefault: boolean; isActive: boolean; stages: { key: string; name: string; nameEn: string | null; category: PipelineStageRow["category"] }[] };

/**
 * Writes a pipeline and its stages. A stage that is still named is kept (its id is what
 * applications point at); one that is gone is removed only when nothing sits on it — a pipeline
 * edit must never silently move people.
 */
export async function savePipeline(pipelineId: string | null, input: PipelineInput): Promise<{ before: PipelineRow | null; after: PipelineRow }> {
  if (input.stages.length === 0) throw new ActionError("recruit_pipeline_empty");
  if (!input.stages.some((stage) => stage.category === "applied")) throw new ActionError("recruit_pipeline_no_entry");
  if (new Set(input.stages.map((stage) => stage.key)).size !== input.stages.length) throw new ActionError("recruit_stage_key_duplicate");

  const saved = await inTransaction(async (tx) => {
    const values = { code: input.code.toUpperCase(), name: input.name, nameEn: input.nameEn, description: input.description, isDefault: input.isDefault, isActive: input.isActive, updatedAt: now() };
    let before: PipelineRow | null = null;
    let after: PipelineRow;
    if (pipelineId) {
      [before] = await tx.select().from(schema.recruitPipeline).where(eq(schema.recruitPipeline.id, pipelineId)).limit(1);
      if (!before) throw new ActionError("recruit_pipeline_not_found");
      [after] = await tx.update(schema.recruitPipeline).set(values).where(eq(schema.recruitPipeline.id, pipelineId)).returning();
    } else {
      [after] = await tx.insert(schema.recruitPipeline).values(values).returning();
    }
    // At most one default, and the database is not asked to remember it for us.
    if (input.isDefault) await tx.update(schema.recruitPipeline).set({ isDefault: false }).where(sql`${schema.recruitPipeline.id} <> ${after.id}`);

    const existing = await tx.select().from(schema.recruitPipelineStage).where(eq(schema.recruitPipelineStage.pipelineId, after.id));
    const keeping = new Set(input.stages.map((stage) => stage.key));
    for (const stage of existing) {
      if (keeping.has(stage.key)) continue;
      const [{ value: sitting }] = await tx.select({ value: count() }).from(schema.jobApplication).where(eq(schema.jobApplication.stageId, stage.id));
      if (sitting > 0) throw new ActionError("recruit_stage_in_use");
      await tx.delete(schema.recruitPipelineStage).where(eq(schema.recruitPipelineStage.id, stage.id));
    }
    for (const [index, stage] of input.stages.entries()) {
      const found = existing.find((row) => row.key === stage.key);
      const row = { pipelineId: after.id, key: stage.key, name: stage.name, nameEn: stage.nameEn, category: stage.category, sortOrder: index, updatedAt: now() };
      if (found) await tx.update(schema.recruitPipelineStage).set(row).where(eq(schema.recruitPipelineStage.id, found.id));
      else await tx.insert(schema.recruitPipelineStage).values(row);
    }
    return { before, after };
  });
  await invalidate(PIPELINES_CACHE);
  return saved;
}

// ── Who may see which openings ──────────────────────────────────────────────────────────────

/**
 * The WHERE clause behind every list in this module: the openings whose entity the principal's
 * `recruit:manage` covers, plus the ones they are on the hiring team of. `sql\`false\`` for
 * somebody with neither, so a query returns nothing rather than everything.
 */
export function openingScope(principal: Principal) {
  const reach = entityReach(principal, "recruit:manage");
  const byEntity = reach.all ? sql`true` : reach.entityIds.length > 0 ? inArray(schema.jobOpening.entityId, reach.entityIds) : undefined;
  const byMembership = principal.personId
    ? exists(
        db()
          .select({ one: sql`1` })
          .from(schema.jobOpeningMember)
          .where(and(eq(schema.jobOpeningMember.openingId, schema.jobOpening.id), eq(schema.jobOpeningMember.personId, principal.personId))),
      )
    : undefined;
  return or(byEntity, byMembership) ?? sql`false`;
}

/**
 * Does the recruitment entry belong in this person's navigation? True for whoever runs
 * recruitment anywhere, and for anybody sitting on a hiring team — which is a row, not a role, so
 * the layout has to ask the database. Cosmetic only: every page and action re-checks.
 */
export async function recruitModuleOpen(principal: Principal, personId: string | null): Promise<boolean> {
  if (canRunRecruitment(principal)) return true;
  if (!personId) return false;
  const [row] = await db().select({ id: schema.jobOpeningMember.id }).from(schema.jobOpeningMember).where(eq(schema.jobOpeningMember.personId, personId)).limit(1);
  return !!row;
}

/** Is this person on the opening's hiring team? The one fact `policy.ts` cannot work out for itself. */
export async function isOpeningMember(openingId: string, personId: string | null, executor?: Executor): Promise<boolean> {
  if (!personId) return false;
  return executor && executor !== db() ? readOpeningMember(openingId, personId, executor) : openingMemberOnce(openingId, personId);
}

// A page, its authorize steps and the lists under it ask the same question: once per request.
const openingMemberOnce = cache((openingId: string, personId: string): Promise<boolean> => readOpeningMember(openingId, personId, db()));

async function readOpeningMember(openingId: string, personId: string, executor: Executor): Promise<boolean> {
  const [row] = await executor
    .select({ id: schema.jobOpeningMember.id })
    .from(schema.jobOpeningMember)
    .where(and(eq(schema.jobOpeningMember.openingId, openingId), eq(schema.jobOpeningMember.personId, personId)))
    .limit(1);
  return !!row;
}

const targetOf = (opening: { entityId: string; departmentId: string | null; teamId: string | null }): OpeningTarget => ({ entityId: opening.entityId, departmentId: opening.departmentId, teamId: opening.teamId });

// ── Openings ────────────────────────────────────────────────────────────────────────────────

export type OpeningListRow = {
  id: string;
  code: string;
  title: string;
  status: OpeningStatus;
  entityName: string | null;
  departmentName: string | null;
  headcount: number;
  publishedAt: Date | null;
  createdAt: Date;
  activeApplications: number;
  hiredCount: number;
};

export async function listOpenings(principal: Principal, filters: { status?: OpeningStatus; entityId?: string; query?: string } = {}): Promise<OpeningListRow[]> {
  // Counted per returned row (at most 200), off the (opening, status) index — not by grouping the
  // whole application table. Built with the query builder: a column written straight into `sql` in
  // a select list renders unqualified, and `opening_id = id` would compare the application's own.
  const applicationsIn = (status: ApplicationStatus) =>
    sql<number>`(${db()
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.jobApplication)
      .where(and(eq(schema.jobApplication.openingId, schema.jobOpening.id), eq(schema.jobApplication.status, status)))})`;

  const rows = await db()
    .select({
      id: schema.jobOpening.id,
      code: schema.jobOpening.code,
      title: schema.jobOpening.title,
      status: schema.jobOpening.status,
      entityName: schema.entity.shortName,
      departmentName: schema.orgUnit.name,
      headcount: schema.jobOpening.headcount,
      publishedAt: schema.jobOpening.publishedAt,
      createdAt: schema.jobOpening.createdAt,
      activeApplications: applicationsIn("active"),
      hiredCount: applicationsIn("hired"),
    })
    .from(schema.jobOpening)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.jobOpening.departmentId))
    .where(
      and(
        openingScope(principal),
        filters.status ? eq(schema.jobOpening.status, filters.status) : undefined,
        filters.entityId ? eq(schema.jobOpening.entityId, filters.entityId) : undefined,
        filters.query?.trim() ? sql`${schema.jobOpening.title} ilike ${`%${filters.query.trim()}%`} or ${schema.jobOpening.code} ilike ${`%${filters.query.trim()}%`}` : undefined,
      ),
    )
    .orderBy(desc(schema.jobOpening.createdAt))
    .limit(200);

  return rows.map((row) => ({ ...row, activeApplications: Number(row.activeApplications ?? 0), hiredCount: Number(row.hiredCount ?? 0) }));
}

export async function findOpening(openingId: string, executor?: Executor): Promise<OpeningRow | undefined> {
  return executor && executor !== db() ? readOpening(openingId, executor) : openingOnce(openingId);
}

// Outside a transaction, once per request: the page, the lists under it and their checks share it.
const openingOnce = cache((openingId: string): Promise<OpeningRow | undefined> => readOpening(openingId, db()));

async function readOpening(openingId: string, executor: Executor): Promise<OpeningRow | undefined> {
  const [row] = await executor.select().from(schema.jobOpening).where(eq(schema.jobOpening.id, openingId)).limit(1);
  return row;
}

/**
 * The opening a public URL names. Published openings only — an unpublished one answers `undefined`
 * exactly like a slug that was never issued, which is what stops the careers page confirming that
 * a draft exists. (Week 2 builds the page; the rule belongs with the data.)
 */
export async function findOpeningBySlug(slug: string, executor: Executor = db()): Promise<OpeningRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.jobOpening)
    .where(and(eq(schema.jobOpening.publicSlug, slug), eq(schema.jobOpening.status, "open")))
    .limit(1);
  return row;
}

export type OpeningMemberRow = typeof schema.jobOpeningMember.$inferSelect;

export type OpeningView = {
  opening: OpeningRow;
  entityName: string | null;
  departmentName: string | null;
  teamName: string | null;
  pipeline: PipelineRow;
  stages: PipelineStageRow[];
  members: { personId: string; fullName: string; role: OpeningMemberRow["role"] }[];
  /** Cut by tier before it leaves the service: null means "you may not see the band", not "there is none". */
  salary: { minVnd: number | null; maxVnd: number | null; isPublic: boolean } | null;
  canEdit: boolean;
  isMember: boolean;
};

export async function getOpeningView(viewer: { principal: Principal; personId: string | null }, openingId: string): Promise<OpeningView | null> {
  const [opening, member] = await Promise.all([findOpening(openingId), isOpeningMember(openingId, viewer.personId)]);
  if (!opening) return null;
  const target = targetOf(opening);
  if (!canViewOpening(viewer.principal, target, member)) return null;

  const [pipelines, members, entities, units] = await Promise.all([
    pipelineTables(),
    db()
      .select({ personId: schema.jobOpeningMember.personId, fullName: schema.person.fullName, role: schema.jobOpeningMember.role })
      .from(schema.jobOpeningMember)
      .innerJoin(schema.person, eq(schema.person.id, schema.jobOpeningMember.personId))
      .where(eq(schema.jobOpeningMember.openingId, openingId))
      .orderBy(asc(schema.jobOpeningMember.role), asc(schema.person.fullName)),
    listEntities(),
    listOrgUnits(),
  ]);
  const pipeline = pipelines.pipelines.find((row) => row.id === opening.pipelineId)!;
  const stages = pipelines.stages.filter((stage) => stage.pipelineId === opening.pipelineId);
  const unitName = (unitId: string | null) => (unitId ? (units.find((unit) => unit.id === unitId)?.name ?? null) : null);

  return {
    opening,
    entityName: entities.find((entity) => entity.id === opening.entityId)?.shortName ?? null,
    departmentName: unitName(opening.departmentId),
    teamName: unitName(opening.teamId),
    pipeline,
    stages,
    members,
    salary: canReadRecruitMoney(viewer.principal, target) ? { minVnd: opening.salaryMinVnd, maxVnd: opening.salaryMaxVnd, isPublic: opening.salaryPublic } : null,
    canEdit: canRunRecruitment(viewer.principal, target),
    isMember: member,
  };
}

export type OpeningInput = {
  title: string;
  titleEn: string | null;
  entityId: string;
  departmentId: string | null;
  teamId: string | null;
  positionName: string | null;
  jobLevel: string | null;
  employmentType: EmploymentType;
  workMode: WorkMode;
  workLocation: string | null;
  headcount: number;
  description: string;
  requirements: string;
  benefits: string;
  pipelineId: string;
  targetStartDate: IsoDate | null;
  questions: OpeningQuestion[];
};

/** The money half, supplied only by a caller the policy has already let near it. */
export type OpeningMoneyInput = { salaryMinVnd: number | null; salaryMaxVnd: number | null; salaryPublic: boolean };

function checkBand(min: number | null, max: number | null) {
  for (const value of [min, max]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ActionError("recruit_salary_invalid");
  if (min !== null && max !== null && min > max) throw new ActionError("recruit_salary_range_invalid");
}

export async function createOpening(input: OpeningInput, money: OpeningMoneyInput | null, actorPersonId: string, options: { hiringRequestId?: string | null } = {}): Promise<OpeningRow> {
  if (money) checkBand(money.salaryMinVnd, money.salaryMaxVnd);
  if (input.headcount < 1 || !Number.isSafeInteger(input.headcount)) throw new ActionError("recruit_headcount_invalid");
  return inTransaction(async (tx) => {
    const [entity] = await tx.select({ code: schema.entity.code, isActive: schema.entity.isActive }).from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
    if (!entity?.isActive) throw new ActionError("recruit_entity_not_found");
    const pipeline = await findPipeline(input.pipelineId, tx);
    if (!pipeline) throw new ActionError("recruit_pipeline_not_found");
    await firstStageOf(input.pipelineId, tx);

    const code = await nextOpeningCode(tx, entity.code, Number(todayInVietnam().slice(0, 4)));
    const [opening] = await tx
      .insert(schema.jobOpening)
      .values({
        ...input,
        ...(money ?? { salaryMinVnd: null, salaryMaxVnd: null, salaryPublic: false }),
        code,
        publicSlug: newPublicSlug(),
        status: "draft",
        hiringRequestId: options.hiringRequestId ?? null,
        createdByPersonId: actorPersonId,
      })
      .returning();
    if (options.hiringRequestId) {
      await tx.update(schema.hiringRequest).set({ openingId: opening.id, status: "fulfilled", updatedAt: now() }).where(eq(schema.hiringRequest.id, options.hiringRequestId));
    }
    return opening;
  });
}

/** `money: null` = the editor may not read the band, so the stored one is left exactly as it was. */
export async function updateOpening(openingId: string, input: OpeningInput, money: OpeningMoneyInput | null): Promise<{ before: OpeningRow; after: OpeningRow }> {
  if (money) checkBand(money.salaryMinVnd, money.salaryMaxVnd);
  const before = await findOpening(openingId);
  if (!before) throw new ActionError("recruit_opening_not_found");
  const [after] = await db()
    .update(schema.jobOpening)
    .set({ ...input, ...(money ?? {}), updatedAt: now() })
    .where(eq(schema.jobOpening.id, openingId))
    .returning();
  return { before, after };
}

/** Publishing is a status change like any other; the slug was minted when the opening was created. */
export async function setOpeningStatus(openingId: string, status: OpeningStatus, reason: string | null): Promise<{ before: OpeningRow; after: OpeningRow }> {
  const before = await findOpening(openingId);
  if (!before) throw new ActionError("recruit_opening_not_found");
  if (before.status === status) throw new ActionError("recruit_status_unchanged");
  const [after] = await db()
    .update(schema.jobOpening)
    .set({
      status,
      publishedAt: status === "open" ? (before.publishedAt ?? now()) : before.publishedAt,
      closedAt: status === "closed" || status === "filled" ? now() : null,
      closeReason: status === "closed" || status === "filled" ? reason : null,
      updatedAt: now(),
    })
    .where(eq(schema.jobOpening.id, openingId))
    .returning();
  return { before, after };
}

/** The hiring team, replaced wholesale — the form shows every member, so a save means "these people". */
export async function setOpeningTeam(openingId: string, members: { personId: string; role: OpeningMemberRow["role"] }[]): Promise<number> {
  return inTransaction(async (tx) => {
    await tx.delete(schema.jobOpeningMember).where(eq(schema.jobOpeningMember.openingId, openingId));
    const unique = [...new Map(members.map((member) => [member.personId, member])).values()];
    if (unique.length > 0) await tx.insert(schema.jobOpeningMember).values(unique.map((member) => ({ openingId, ...member })));
    return unique.length;
  });
}

// ── Candidates (FR-REC-04) ──────────────────────────────────────────────────────────────────

export type CandidateInput = {
  fullName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  location: string | null;
  links: string[];
  source: CandidateSource;
  sourceDetail: string | null;
  referredByPersonId: string | null;
  tags: string[];
  notes: string | null;
};

/** The normalised keys and the search key, derived in one place so the public form and the recruiter's form agree. */
export function candidateKeys(input: { fullName: string; email: string | null; phone: string | null }) {
  return { searchName: toSearchKey(input.fullName), emailKey: normaliseEmail(input.email), phoneKey: normalisePhone(input.phone) };
}

/** Default retention: today plus the configured window (FR-REC-13). Extended only by talent-pool consent. */
export const defaultRetainUntil = (from: IsoDate = todayInVietnam()): IsoDate => {
  const [year, month, day] = from.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + DEFAULT_RETENTION_MONTHS, day));
  return date.toISOString().slice(0, 10) as IsoDate;
};

/**
 * The candidates already on file that look like this one. Cheap: the two identifier keys are
 * indexed, and the name is only compared against people whose *search name* matches — a full
 * similarity sweep of the whole database would not be worth what it costs.
 */
export async function findLikelyCandidateDuplicates(input: { fullName: string; email: string | null; phone: string | null }, exceptCandidateId?: string, executor: Executor = db()): Promise<DuplicateMatch[]> {
  const probe = probeFor(input);
  const searchName = toSearchKey(input.fullName);
  const conditions = [
    probe.emailKey ? eq(schema.candidate.emailKey, probe.emailKey) : undefined,
    probe.phoneKey ? eq(schema.candidate.phoneKey, probe.phoneKey) : undefined,
    searchName ? eq(schema.candidate.searchName, searchName) : undefined,
  ].filter(Boolean);
  if (conditions.length === 0) return [];

  const rows = await executor
    .select({ id: schema.candidate.id, fullName: schema.candidate.fullName, searchName: schema.candidate.searchName, emailKey: schema.candidate.emailKey, phoneKey: schema.candidate.phoneKey })
    .from(schema.candidate)
    .where(and(isNull(schema.candidate.anonymisedAt), exceptCandidateId ? sql`${schema.candidate.id} <> ${exceptCandidateId}` : undefined, or(...conditions)))
    .limit(50);
  return rankDuplicates(probe, rows as CandidateLike[]);
}

/**
 * A new candidate. An identifier match is refused outright; a bare name match is refused *once*,
 * with the likely duplicates attached, and a recruiter who has looked at them passes
 * `confirmedNotDuplicate` to say this is somebody else. The same check guards the public
 * application form in week 2, which of course has nobody to confirm anything — so there it
 * attaches the new application to the candidate already on file instead.
 */
export async function createCandidate(input: CandidateInput, actorPersonId: string | null, options: { confirmedNotDuplicate?: boolean; consent?: { at: Date; version: string; talentPool: boolean } } = {}, executor: Executor = db()): Promise<CandidateRow> {
  const name = input.fullName.trim().replace(/\s+/g, " ");
  if (name === "") throw new ActionError("recruit_candidate_name_required");
  const duplicates = await findLikelyCandidateDuplicates({ ...input, fullName: name }, undefined, executor);
  if (isCertainDuplicate(duplicates)) throw new ActionError("recruit_candidate_duplicate", { duplicates });
  if (duplicates.length > 0 && !options.confirmedNotDuplicate) throw new ActionError("recruit_candidate_possible_duplicate", { duplicates });

  const keys = candidateKeys({ fullName: name, email: input.email, phone: input.phone });
  const [row] = await executor
    .insert(schema.candidate)
    .values({
      ...input,
      fullName: name,
      ...keys,
      consentAt: options.consent?.at ?? null,
      consentVersion: options.consent?.version ?? null,
      talentPoolConsent: options.consent?.talentPool ?? false,
      retainUntil: defaultRetainUntil(),
      createdByPersonId: actorPersonId,
    })
    .returning();
  return row;
}

export async function updateCandidate(candidateId: string, input: CandidateInput): Promise<{ before: CandidateRow; after: CandidateRow }> {
  const [before] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidateId)).limit(1);
  if (!before) throw new ActionError("recruit_candidate_not_found");
  if (before.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");
  const name = input.fullName.trim().replace(/\s+/g, " ");
  const [after] = await db()
    .update(schema.candidate)
    .set({ ...input, fullName: name, ...candidateKeys({ fullName: name, email: input.email, phone: input.phone }), updatedAt: now() })
    .where(eq(schema.candidate.id, candidateId))
    .returning();
  return { before, after };
}

export async function findCandidate(candidateId: string, executor: Executor = db()): Promise<CandidateRow | undefined> {
  const [row] = await executor.select().from(schema.candidate).where(eq(schema.candidate.id, candidateId)).limit(1);
  return row;
}

export type CandidateListRow = { id: string; fullName: string; currentTitle: string | null; source: CandidateSource; tags: string[]; createdAt: Date; applications: number; anonymised: boolean };

/**
 * The candidate database (FR-REC-04). Two kinds of row, and both are scoped:
 *   · anybody who has applied to an opening the principal may see;
 *   · a sourced lead who has not applied anywhere yet — visible to a group-wide `recruit:manage`
 *     only, because a candidate row carries no entity of its own and there is nothing to scope a
 *     narrower grant against.
 */
export async function listCandidates(principal: Principal, filters: { query?: string; tag?: string; source?: CandidateSource; /** Leave out whoever already applied here. */ notAppliedTo?: string; /** Leave out anonymised rows. */ identifiedOnly?: boolean } = {}): Promise<CandidateListRow[]> {
  if (!canBrowseCandidates(principal)) return [];
  const reach = entityReach(principal, "recruit:manage");

  const reachable = exists(
    db()
      .select({ one: sql`1` })
      .from(schema.jobApplication)
      .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.jobApplication.openingId))
      .where(and(eq(schema.jobApplication.candidateId, schema.candidate.id), openingScope(principal))),
  );
  // `notExists` on the query builder, not a hand-written `sql` fragment: a drizzle column embedded
  // in `sql` renders *unqualified*, so `candidate_id = id` inside the subquery compares the
  // application's own two columns and is never true — the clause would silently mean "always".
  const unapplied = and(
    notExists(
      db()
        .select({ one: sql`1` })
        .from(schema.jobApplication)
        .where(eq(schema.jobApplication.candidateId, schema.candidate.id)),
    ),
    reach.all ? sql`true` : sql`false`,
  );

  // Counted for the rows returned only (at most 200), off the candidate index.
  const applications = sql<number>`(${db().select({ value: sql<number>`count(*)::int` }).from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, schema.candidate.id))})`;

  const query = filters.query?.trim();
  const rows = await db()
    .select({
      id: schema.candidate.id,
      fullName: schema.candidate.fullName,
      currentTitle: schema.candidate.currentTitle,
      source: schema.candidate.source,
      tags: schema.candidate.tags,
      createdAt: schema.candidate.createdAt,
      anonymisedAt: schema.candidate.anonymisedAt,
      applications,
    })
    .from(schema.candidate)
    .where(
      and(
        or(reachable, unapplied),
        filters.tag ? sql`${filters.tag} = any(${schema.candidate.tags})` : undefined,
        filters.source ? eq(schema.candidate.source, filters.source) : undefined,
        filters.notAppliedTo
          ? notExists(
              db()
                .select({ one: sql`1` })
                .from(schema.jobApplication)
                .where(and(eq(schema.jobApplication.candidateId, schema.candidate.id), eq(schema.jobApplication.openingId, filters.notAppliedTo))),
            )
          : undefined,
        filters.identifiedOnly ? isNull(schema.candidate.anonymisedAt) : undefined,
        query ? sql`(${schema.candidate.searchName} like ${`%${toSearchKey(query)}%`} or ${schema.candidate.emailKey} like ${`%${query.toLowerCase()}%`})` : undefined,
      ),
    )
    .orderBy(desc(schema.candidate.createdAt))
    .limit(200);

  return rows.map((row) => ({ ...row, applications: Number(row.applications ?? 0), anonymised: !!row.anonymisedAt }));
}

export type CandidateApplicationRow = { applicationId: string; openingId: string; openingCode: string; openingTitle: string; stageName: string; status: ApplicationStatus; appliedAt: Date };

export type CandidateView = {
  candidate: CandidateRow;
  applications: CandidateApplicationRow[];
  referredByName: string | null;
  canManage: boolean;
};

export async function getCandidateView(viewer: { principal: Principal; personId: string | null }, candidateId: string): Promise<CandidateView | null> {
  const [candidate, applications] = await Promise.all([
    findCandidate(candidateId),
    db()
      .select({
        applicationId: schema.jobApplication.id,
        openingId: schema.jobOpening.id,
        openingCode: schema.jobOpening.code,
        openingTitle: schema.jobOpening.title,
        stageName: schema.recruitPipelineStage.name,
        status: schema.jobApplication.status,
        appliedAt: schema.jobApplication.appliedAt,
      })
      .from(schema.jobApplication)
      .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.jobApplication.openingId))
      .innerJoin(schema.recruitPipelineStage, eq(schema.recruitPipelineStage.id, schema.jobApplication.stageId))
      .where(and(eq(schema.jobApplication.candidateId, candidateId), openingScope(viewer.principal)))
      .orderBy(desc(schema.jobApplication.appliedAt)),
  ]);
  if (!candidate) return null;

  // A candidate is reached either by browsing the database or through an opening you may see.
  // Somebody with neither gets the same answer as a candidate that does not exist.
  if (!canBrowseCandidates(viewer.principal) && applications.length === 0) return null;
  const [[anyApplication], [referrer]] = await Promise.all([
    canBrowseCandidates(viewer.principal) && applications.length === 0 ? db().select({ id: schema.jobApplication.id }).from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidateId)).limit(1) : [undefined],
    candidate.referredByPersonId ? db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, candidate.referredByPersonId)).limit(1) : [undefined],
  ]);
  if (anyApplication && !entityReach(viewer.principal, "recruit:manage").all) return null;

  return { candidate, applications, referredByName: referrer?.fullName ?? null, canManage: canBrowseCandidates(viewer.principal) };
}

// ── Applications ────────────────────────────────────────────────────────────────────────────

export type ApplicationInput = {
  candidateId: string;
  openingId: string;
  source: CandidateSource;
  sourceDetail: string | null;
  coverLetter: string | null;
  answers: Record<string, string>;
  cvFileId: string | null;
  portfolioLinks: string[];
  salaryExpectationVnd: number | null;
  salaryExpectationNote: string | null;
};

/** One row of the append-only history. Every use-case that moves an application writes one. */
export async function recordApplicationEvent(
  executor: Executor,
  event: { applicationId: string; type: ApplicationEventType; fromStageId?: string | null; toStageId?: string | null; actorPersonId: string | null; note?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  await executor.insert(schema.applicationEvent).values({
    applicationId: event.applicationId,
    type: event.type,
    fromStageId: event.fromStageId ?? null,
    toStageId: event.toStageId ?? null,
    actorPersonId: event.actorPersonId,
    note: event.note ?? null,
    detail: event.detail ?? null,
  });
}

/**
 * Somebody applies. The stage is the pipeline's first — not the caller's choice — and the unique
 * index on (candidate, opening) is what stops a second application to the same job; the check here
 * exists to give a decent message, not to be the rule.
 */
export async function createApplication(input: ApplicationInput, actorPersonId: string | null, executor?: Executor): Promise<ApplicationRow> {
  const run = async (tx: Executor) => {
    const opening = await findOpening(input.openingId, tx);
    if (!opening) throw new ActionError("recruit_opening_not_found");
    const [existing] = await tx
      .select({ id: schema.jobApplication.id })
      .from(schema.jobApplication)
      .where(and(eq(schema.jobApplication.candidateId, input.candidateId), eq(schema.jobApplication.openingId, input.openingId)))
      .limit(1);
    if (existing) throw new ActionError("recruit_already_applied");
    const stage = await firstStageOf(opening.pipelineId, tx);

    const [application] = await tx
      .insert(schema.jobApplication)
      .values({ ...input, stageId: stage.id, status: "active", appliedAt: now(), stageEnteredAt: now() })
      .returning();
    await recordApplicationEvent(tx, { applicationId: application.id, type: "applied", toStageId: stage.id, actorPersonId, detail: { source: input.source } });
    return application;
  };
  return executor ? run(executor) : inTransaction(run);
}

export async function findApplication(applicationId: string, executor: Executor = db()): Promise<ApplicationRow | undefined> {
  const [row] = await executor.select().from(schema.jobApplication).where(eq(schema.jobApplication.id, applicationId)).limit(1);
  return row;
}

/** Moves an application to another stage of its opening's pipeline, writing the move to its history. */
export async function moveApplicationStage(applicationId: string, toStageId: string, actorPersonId: string, note: string | null): Promise<{ before: ApplicationRow; after: ApplicationRow; stage: PipelineStageRow }> {
  return inTransaction(async (tx) => {
    const before = await findApplication(applicationId, tx);
    if (!before) throw new ActionError("recruit_application_not_found");
    if (APPLICATION_CLOSED.includes(before.status)) throw new ActionError("recruit_application_closed");
    const opening = await findOpening(before.openingId, tx);
    const [stage] = await tx.select().from(schema.recruitPipelineStage).where(eq(schema.recruitPipelineStage.id, toStageId)).limit(1);
    // A stage of another pipeline is not a stage of this application at all.
    if (!stage || !opening || stage.pipelineId !== opening.pipelineId) throw new ActionError("recruit_stage_not_found");
    if (stage.id === before.stageId) throw new ActionError("recruit_stage_unchanged");

    // Reaching the hired stage does not hire anybody: an offer does (week 4). The stage is where
    // they are; the status is what happened.
    const [after] = await tx.update(schema.jobApplication).set({ stageId: stage.id, stageEnteredAt: now(), updatedAt: now() }).where(eq(schema.jobApplication.id, applicationId)).returning();
    await recordApplicationEvent(tx, { applicationId, type: "stage_moved", fromStageId: before.stageId, toStageId: stage.id, actorPersonId, note });
    return { before, after, stage };
  });
}

export async function rejectApplication(applicationId: string, input: { reason: RejectionReason; note: string | null }, actorPersonId: string): Promise<{ before: ApplicationRow; after: ApplicationRow }> {
  return inTransaction(async (tx) => {
    const before = await findApplication(applicationId, tx);
    if (!before) throw new ActionError("recruit_application_not_found");
    if (APPLICATION_CLOSED.includes(before.status)) throw new ActionError("recruit_application_closed");
    const [after] = await tx
      .update(schema.jobApplication)
      .set({ status: "rejected", rejectionReason: input.reason, rejectionNote: input.note, closedAt: now(), decidedByPersonId: actorPersonId, updatedAt: now() })
      .where(eq(schema.jobApplication.id, applicationId))
      .returning();
    // The stage is left where it was: that is what makes the funnel report able to say where
    // people fall out.
    await recordApplicationEvent(tx, { applicationId, type: "rejected", fromStageId: before.stageId, actorPersonId, note: input.note, detail: { reason: input.reason } });
    return { before, after };
  });
}

export async function withdrawApplication(applicationId: string, actorPersonId: string | null, note: string | null): Promise<{ before: ApplicationRow; after: ApplicationRow }> {
  return inTransaction(async (tx) => {
    const before = await findApplication(applicationId, tx);
    if (!before) throw new ActionError("recruit_application_not_found");
    if (APPLICATION_CLOSED.includes(before.status)) throw new ActionError("recruit_application_closed");
    const [after] = await tx
      .update(schema.jobApplication)
      .set({ status: "withdrawn", closedAt: now(), decidedByPersonId: actorPersonId, updatedAt: now() })
      .where(eq(schema.jobApplication.id, applicationId))
      .returning();
    await recordApplicationEvent(tx, { applicationId, type: "withdrawn", fromStageId: before.stageId, actorPersonId, note });
    return { before, after };
  });
}

export type ApplicationListRow = {
  id: string;
  candidateId: string;
  candidateName: string;
  currentTitle: string | null;
  stageId: string;
  stageName: string;
  stageOrder: number;
  status: ApplicationStatus;
  appliedAt: Date;
  stageEnteredAt: Date;
  /** How long this card has been sitting in its column. Counted by the database's clock, not the page's. */
  daysInStage: number;
  source: CandidateSource;
};

/** Every application on one opening, in stage order — the list the kanban board (week 2) groups. */
export async function listApplications(viewer: { principal: Principal; personId: string | null }, openingId: string, filters: { status?: ApplicationStatus } = {}): Promise<ApplicationListRow[]> {
  const [opening, member] = await Promise.all([findOpening(openingId), isOpeningMember(openingId, viewer.personId)]);
  if (!opening) return [];
  if (!canViewOpening(viewer.principal, targetOf(opening), member)) return [];

  return db()
    .select({
      id: schema.jobApplication.id,
      candidateId: schema.candidate.id,
      candidateName: schema.candidate.fullName,
      currentTitle: schema.candidate.currentTitle,
      stageId: schema.recruitPipelineStage.id,
      stageName: schema.recruitPipelineStage.name,
      stageOrder: schema.recruitPipelineStage.sortOrder,
      status: schema.jobApplication.status,
      appliedAt: schema.jobApplication.appliedAt,
      stageEnteredAt: schema.jobApplication.stageEnteredAt,
      daysInStage: sql<number>`greatest(0, floor(extract(epoch from now() - ${schema.jobApplication.stageEnteredAt}) / 86400))::int`,
      source: schema.jobApplication.source,
    })
    .from(schema.jobApplication)
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.jobApplication.candidateId))
    .innerJoin(schema.recruitPipelineStage, eq(schema.recruitPipelineStage.id, schema.jobApplication.stageId))
    .where(and(eq(schema.jobApplication.openingId, openingId), filters.status ? eq(schema.jobApplication.status, filters.status) : undefined))
    .orderBy(asc(schema.recruitPipelineStage.sortOrder), asc(schema.jobApplication.appliedAt));
}

export type ApplicationEventView = { id: number; type: ApplicationEventType; at: Date; actorName: string | null; note: string | null; fromStageName: string | null; toStageName: string | null; detail: Record<string, unknown> | null };

export type ApplicationView = {
  application: ApplicationRow;
  candidate: CandidateRow;
  opening: OpeningRow;
  stages: PipelineStageRow[];
  stage: PipelineStageRow;
  events: ApplicationEventView[];
  /** Cut by tier before it leaves the service. */
  salaryExpectationVnd: number | null;
  /** The CV's name, for the download link. Null when there is none — the id alone opens nothing. */
  cvFileName: string | null;
  canAct: boolean;
  canReadMoney: boolean;
};

export async function getApplicationView(viewer: { principal: Principal; personId: string | null }, applicationId: string): Promise<ApplicationView | null> {
  const application = await findApplication(applicationId);
  if (!application) return null;
  const fromStage = alias(schema.recruitPipelineStage, "from_stage");
  const toStage = alias(schema.recruitPipelineStage, "to_stage");
  // Everything at once; nothing of it leaves here unless the viewer passes the check below.
  const [opening, member, candidate, events, cvFileName] = await Promise.all([
    findOpening(application.openingId),
    isOpeningMember(application.openingId, viewer.personId),
    findCandidate(application.candidateId),
    db()
      .select({
        id: schema.applicationEvent.id,
        type: schema.applicationEvent.type,
        at: schema.applicationEvent.at,
        actorName: schema.person.fullName,
        note: schema.applicationEvent.note,
        fromStageName: fromStage.name,
        toStageName: toStage.name,
        detail: schema.applicationEvent.detail,
      })
      .from(schema.applicationEvent)
      .leftJoin(schema.person, eq(schema.person.id, schema.applicationEvent.actorPersonId))
      .leftJoin(fromStage, eq(fromStage.id, schema.applicationEvent.fromStageId))
      .leftJoin(toStage, eq(toStage.id, schema.applicationEvent.toStageId))
      .where(eq(schema.applicationEvent.applicationId, applicationId))
      .orderBy(desc(schema.applicationEvent.id)),
    application.cvFileId ? listFileNames([application.cvFileId]).then((names) => names.get(application.cvFileId!) ?? null) : null,
  ]);
  if (!opening) return null;
  const target = targetOf(opening);
  if (!canViewOpening(viewer.principal, target, member)) return null;

  if (!candidate) return null;
  const stages = await stagesOf(opening.pipelineId);
  const stage = stages.find((row) => row.id === application.stageId);
  if (!stage) return null;

  const money = canReadRecruitMoney(viewer.principal, target);
  return {
    application,
    candidate,
    opening,
    stages,
    stage,
    events,
    salaryExpectationVnd: money ? application.salaryExpectationVnd : null,
    cvFileName,
    canAct: canViewOpening(viewer.principal, target, member),
    canReadMoney: money,
  };
}

// ── Hiring requests (FR-REC-01) ─────────────────────────────────────────────────────────────

export type HiringRequestListRow = { id: string; positionTitle: string; headcount: number; status: HiringRequestRow["status"]; entityName: string | null; departmentName: string | null; requesterName: string; createdAt: Date; approvalRequestId: string | null; openingId: string | null };

/** The asks the principal may see: theirs, the ones they will manage, and the ones in their recruitment scope. */
export async function listHiringRequests(principal: Principal): Promise<HiringRequestListRow[]> {
  const reach = entityReach(principal, "recruit:manage");
  const byReach = reach.all ? sql`true` : reach.entityIds.length > 0 ? inArray(schema.hiringRequest.entityId, reach.entityIds) : undefined;
  const mine = principal.personId ? or(eq(schema.hiringRequest.requestedByPersonId, principal.personId), eq(schema.hiringRequest.hiringManagerPersonId, principal.personId)) : undefined;
  return db()
    .select({
      id: schema.hiringRequest.id,
      positionTitle: schema.hiringRequest.positionTitle,
      headcount: schema.hiringRequest.headcount,
      status: schema.hiringRequest.status,
      entityName: schema.entity.shortName,
      departmentName: schema.orgUnit.name,
      requesterName: schema.person.fullName,
      createdAt: schema.hiringRequest.createdAt,
      approvalRequestId: schema.hiringRequest.approvalRequestId,
      openingId: schema.hiringRequest.openingId,
    })
    .from(schema.hiringRequest)
    .innerJoin(schema.person, eq(schema.person.id, schema.hiringRequest.requestedByPersonId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.hiringRequest.entityId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.hiringRequest.departmentId))
    .where(or(byReach, mine) ?? sql`false`)
    .orderBy(desc(schema.hiringRequest.createdAt))
    .limit(200);
}

export async function findHiringRequest(hiringRequestId: string, executor: Executor = db()): Promise<HiringRequestRow | undefined> {
  const [row] = await executor.select().from(schema.hiringRequest).where(eq(schema.hiringRequest.id, hiringRequestId)).limit(1);
  return row;
}

/** Headcount planning, in the small (FR-CHR-17): approved heads per department against what is filled. */
export type HeadcountRow = { departmentId: string | null; departmentName: string | null; entityName: string | null; approvedHeads: number; openHeads: number; hired: number };

export async function headcountPlan(principal: Principal): Promise<HeadcountRow[]> {
  const reach = entityReach(principal, "recruit:manage");
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await db()
    .select({
      departmentId: schema.hiringRequest.departmentId,
      departmentName: schema.orgUnit.name,
      entityName: schema.entity.shortName,
      approvedHeads: sql<number>`sum(${schema.hiringRequest.headcount})`,
      fulfilled: sql<number>`sum(case when ${schema.hiringRequest.status} = 'fulfilled' then ${schema.hiringRequest.headcount} else 0 end)`,
    })
    .from(schema.hiringRequest)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.hiringRequest.departmentId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.hiringRequest.entityId))
    .where(and(inArray(schema.hiringRequest.status, ["approved", "fulfilled"]), reach.all ? undefined : inArray(schema.hiringRequest.entityId, reach.entityIds)))
    .groupBy(schema.hiringRequest.departmentId, schema.orgUnit.name, schema.entity.shortName);

  return rows.map((row) => ({
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    entityName: row.entityName,
    approvedHeads: Number(row.approvedHeads ?? 0),
    openHeads: Number(row.approvedHeads ?? 0) - Number(row.fulfilled ?? 0),
    hired: Number(row.fulfilled ?? 0),
  }));
}

/**
 * The recruitment funnel (FR-REC-11), for Phase 9's dashboard and scheduled reports. Scoped by the
 * same `openingScope` clause as every other list here: a reader who can see no opening gets an
 * empty report. `canReadRecruitReports` is the predicate its own screen checks.
 */
export { defaultReportFrom, getRecruitReport, type RecruitReport, type RecruitReportFilters } from "./reports";
export { canReadRecruitReports } from "./policy";
