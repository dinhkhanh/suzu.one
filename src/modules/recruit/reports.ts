import "server-only";
// The recruitment reports (FR-REC-11). One query, scoped by the same `openingScope` clause every
// other list in this module uses, handed to the pure engine in `engine/funnel.ts`.
//
// **Nothing here is a permission check.** The page checks `canReadRecruitReports`; this function
// decides *which* openings the numbers are counted over, and somebody who can see no opening gets
// an empty report rather than a refusal — the same answer they would get by opening the openings
// list. No figure on this page is anything its reader could not already reach an opening at a time.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { Principal } from "@/modules/platform/rbac/policy";
import { type FunnelApplication, type FunnelReport, funnelReport } from "./engine/funnel";
import type { ApplicationStatus, CandidateSource, StageCategory } from "./enums";
import { openingScope } from "./service";

export type RecruitReportFilters = {
  /** Applications received on or after this day. */
  from?: IsoDate;
  to?: IsoDate;
  openingId?: string;
  entityId?: string;
};

export type OpeningOption = { id: string; code: string; title: string; entityName: string | null };

export type RecruitReport = FunnelReport & {
  /** The openings the reader could have asked about — the filter's own options. */
  openings: OpeningOption[];
  /** Openings standing open right now in the reader's scope, for the headline beside the funnel. */
  openOpenings: number;
};

/**
 * Days from applying to becoming a colleague. Computed **in SQL**, for two reasons: a server
 * component may not call `Date.now()` (`react-hooks/purity`), and the hire date is the accepted
 * offer's start date when there is one — the day the person actually joins — falling back to when
 * the application was closed.
 */
const daysToHire = sql<number | null>`
  case when ${schema.jobApplication.status} = 'hired' then
    extract(day from coalesce(${schema.jobApplication.closedAt}, ${schema.jobApplication.updatedAt}) - ${schema.jobApplication.appliedAt})::int
  else null end
`;

export async function getRecruitReport(principal: Principal, filters: RecruitReportFilters = {}): Promise<RecruitReport> {
  const scope = openingScope(principal);
  const period = and(
    filters.from ? gte(schema.jobApplication.appliedAt, sql`${filters.from}::date`) : undefined,
    // Inclusive of the closing day: `applied_at` is an instant, so "to 2026-09-30" means up to the
    // last moment of that day, not up to its midnight.
    filters.to ? lte(schema.jobApplication.appliedAt, sql`${filters.to}::date + interval '1 day'`) : undefined,
    filters.openingId ? eq(schema.jobApplication.openingId, filters.openingId) : undefined,
    filters.entityId ? eq(schema.jobOpening.entityId, filters.entityId) : undefined,
  );

  const rows = await db()
    .select({
      category: schema.recruitPipelineStage.category,
      status: schema.jobApplication.status,
      source: schema.jobApplication.source,
      days: daysToHire.as("days_to_hire"),
    })
    .from(schema.jobApplication)
    .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.jobApplication.openingId))
    .innerJoin(schema.recruitPipelineStage, eq(schema.recruitPipelineStage.id, schema.jobApplication.stageId))
    .where(and(scope, period))
    .limit(20_000);

  const applications: FunnelApplication[] = rows.map((row) => ({
    category: row.category as StageCategory,
    status: row.status as ApplicationStatus,
    source: row.source as CandidateSource,
    daysToHire: row.days === null ? null : Number(row.days),
  }));

  const openings = await db()
    .select({ id: schema.jobOpening.id, code: schema.jobOpening.code, title: schema.jobOpening.title, entityName: schema.entity.shortName })
    .from(schema.jobOpening)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .where(scope)
    .orderBy(desc(schema.jobOpening.createdAt))
    .limit(200);

  const [open] = await db()
    .select({ openNow: sql<number>`count(*)`.as("open_now") })
    .from(schema.jobOpening)
    .where(and(scope, inArray(schema.jobOpening.status, ["open"])));

  return { ...funnelReport(applications), openings, openOpenings: Number(open?.openNow ?? 0) };
}

/** The first day of the month `months` before this one — the report's default period. */
export function defaultReportFrom(today: IsoDate = todayInVietnam(), months = 6): IsoDate {
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 - months, 1));
  return start.toISOString().slice(0, 10) as IsoDate;
}

/** Openings whose funnel the reader may narrow to, ordered by title for the filter. */
export async function listReportOpenings(principal: Principal): Promise<OpeningOption[]> {
  return db()
    .select({ id: schema.jobOpening.id, code: schema.jobOpening.code, title: schema.jobOpening.title, entityName: schema.entity.shortName })
    .from(schema.jobOpening)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .where(openingScope(principal))
    .orderBy(asc(schema.jobOpening.title))
    .limit(200);
}
