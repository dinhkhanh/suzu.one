// Payslips (FR-PAY-32): releasing an approved run to the people in it, and reading one back.
//
// A payslip is not a second copy of anyone's pay. The figures stay in `payroll_run_person`, where
// the run put them; a `payslip` row says that the month was *released* to that person and whether
// they have read it. Nothing can drift, and a locked run's payslip is as immutable as the run.
//
// Who may read one (SRS §2.2, FR-ACL-04) is `canViewCompensationOf`: **the person themselves, C&B
// over their entity, and the owner**. Not their line manager, not their department head, not the
// entity director, not HR staff, not the CEO — the CEO signs a run against totals and the variance
// list, and never opens a payslip. `getPayslipView` answers null to everyone else, exactly as it
// does for an id that does not exist, so an id is not a way to find out who is paid where.
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollNames } from "@/modules/core-hr/service";
import { notify } from "@/modules/platform/notifications/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import type { CalculationContext } from "./calculation";
import { resolveCatalogue, resolveCatalogueVersions } from "./components";
import type { PersonPayResult } from "./engine/types";
import { hasReached } from "./lifecycle";
import { canManageCompensation, canViewCompensationOf, compensationReach } from "./policy";
import { withinReach } from "./reach";
import { loadRunPeople, openResult, type PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

export type PayslipRow = typeof schema.payslip.$inferSelect;
export type PayslipQueryRow = typeof schema.payslipQuery.$inferSelect;
export type PayslipQueryMessageRow = typeof schema.payslipQueryMessage.$inferSelect;

// ── Releasing a run (FR-PAY-32: "published to ESS after approval") ──────────────────────────

/**
 * Releases every person's payslip in an approved run. Idempotent: running it again adds the
 * payslips of anyone who was missing one (a recalculated run) and tells nobody twice.
 *
 * No authorization inside — the action checks `payroll:propose` over the run's entity first.
 */
export async function publishPayslips(runId: string, actorPersonId: string | null): Promise<{ published: number; alreadyPublished: number }> {
  const { created, run } = await db().transaction(async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!run) throw new ActionError("run_not_found");
    // The CEO signs first (SRS D17). Nothing reaches an employee that has not been approved.
    if (!hasReached(run, "approved")) throw new ActionError("run_not_approved", { status: run.status });

    const people = await tx.select({ personId: schema.payrollRunPerson.personId }).from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
    if (people.length === 0) throw new ActionError("run_is_empty");

    const created = await tx
      .insert(schema.payslip)
      .values(people.map(({ personId }) => ({ runId, personId, entityId: run.entityId, month: run.month, publishedByPersonId: actorPersonId })))
      .onConflictDoNothing()
      .returning();

    // The first release dates the run; a later top-up leaves that date alone.
    if (!run.payslipsPublishedAt) {
      await tx.update(schema.payrollRun).set({ payslipsPublishedAt: new Date(), payslipsPublishedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.payrollRun.id, runId));
    }
    return { created, run };
  });

  if (created.length > 0) {
    // The month, and where to read it. Never a figure: a notification is read on a lock screen.
    await notify({ recipients: created.map((row) => row.personId), kind: "payroll.payslip_published", params: { month: run.month }, link: "/payslips" });
  }
  return { published: created.length, alreadyPublished: 0 };
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type MyPayslipRow = { id: string; month: string; entityCode: string; net: number; publishedAt: Date; firstViewedAt: Date | null; kind: PayrollRunRow["kind"]; runName: string | null; openQueries: number };

/** The person's own payslips, newest month first. Their own pay needs no permission. */
export async function listMyPayslips(personId: string): Promise<MyPayslipRow[]> {
  // The count of questions still open rides along as a correlated subquery: one round trip.
  const rows = await db()
    .select({
      payslip: schema.payslip,
      runKind: schema.payrollRun.kind,
      runName: schema.payrollRun.name,
      entityCode: schema.entity.code,
      person: schema.payrollRunPerson,
      openQueries: sql<number>`(select count(*)::int from ${schema.payslipQuery} where ${schema.payslipQuery.payslipId} = ${schema.payslip.id} and ${schema.payslipQuery.status} in ('open', 'answered'))`,
    })
    .from(schema.payslip)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payslip.runId))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payslip.entityId))
    .innerJoin(schema.payrollRunPerson, and(eq(schema.payrollRunPerson.runId, schema.payslip.runId), eq(schema.payrollRunPerson.personId, schema.payslip.personId)))
    .where(eq(schema.payslip.personId, personId))
    .orderBy(desc(schema.payslip.month), desc(schema.payslip.publishedAt));

  return rows.map((row) => ({
    id: row.payslip.id,
    month: row.payslip.month,
    entityCode: row.entityCode,
    net: openResult(row.person).totals.net,
    publishedAt: row.payslip.publishedAt,
    firstViewedAt: row.payslip.firstViewedAt,
    kind: row.runKind,
    runName: row.runName,
    openQueries: Number(row.openQueries),
  }));
}

export type PayslipQueryThread = { query: PayslipQueryRow; messages: (PayslipQueryMessageRow & { authorName: string })[] };

export type PayslipView = {
  payslip: PayslipRow;
  run: Pick<PayrollRunRow, "id" | "month" | "kind" | "name" | "status" | "context">;
  entity: { id: string; code: string; legalName: string; shortName: string; taxCode: string | null; address: string | null };
  person: { id: string; fullName: string; employeeCode: string | null; positionName: string | null; departmentName: string | null };
  result: PersonPayResult;
  /** Component code → the name it had when the run was made (FR-PAY-20: a past payslip reads as it did). */
  componentNames: ReadonlyMap<string, string>;
  queries: PayslipQueryThread[];
  /** True when the viewer is the person themselves — the only one who may raise a query. */
  isOwner: boolean;
  /** True for C&B over the entity and for the owner: they answer queries. */
  manages: boolean;
};

/**
 * One payslip with everything needed to explain it. **null when the viewer may not see it** —
 * the same answer as an id that does not exist.
 */
export async function getPayslipView(principal: Principal, payslipId: string): Promise<PayslipView | null> {
  const [found] = await db()
    .select({
      payslip: schema.payslip,
      run: { id: schema.payrollRun.id, month: schema.payrollRun.month, kind: schema.payrollRun.kind, name: schema.payrollRun.name, status: schema.payrollRun.status, context: schema.payrollRun.context },
      entity: { id: schema.entity.id, code: schema.entity.code, legalName: schema.entity.legalName, shortName: schema.entity.shortName, taxCode: schema.entity.taxCode, address: schema.entity.address },
      runPerson: schema.payrollRunPerson,
    })
    .from(schema.payslip)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payslip.runId))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payslip.entityId))
    .innerJoin(schema.payrollRunPerson, and(eq(schema.payrollRunPerson.runId, schema.payslip.runId), eq(schema.payrollRunPerson.personId, schema.payslip.personId)))
    .where(eq(schema.payslip.id, payslipId))
    .limit(1);
  if (!found) return null;

  const { payslip, run, entity, runPerson } = found;
  // Self, C&B over the entity, or the owner. Nobody else — not the manager, not the CEO.
  if (!canViewCompensationOf(principal, { personId: payslip.personId, entityId: payslip.entityId })) return null;

  // Who they are, the component names and the questions, side by side. The position they held is
  // the one of their latest employment's primary assignment; the department is the person's own.
  const latest = db().select({ id: schema.employment.id, employeeCode: schema.employment.employeeCode }).from(schema.employment).where(eq(schema.employment.personId, schema.person.id)).orderBy(desc(schema.employment.startDate)).limit(1).as("latest");
  const held = db()
    .select({ positionName: schema.position.name })
    .from(schema.assignment)
    .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .where(and(eq(schema.assignment.employmentId, latest.id), eq(schema.assignment.kind, "primary"), isNull(schema.assignment.validTo)))
    .limit(1)
    .as("held");
  const [[person], componentNames, queries] = await Promise.all([
    db()
      .select({ fullName: schema.person.fullName, employeeCode: latest.employeeCode, positionName: held.positionName, departmentName: schema.orgUnit.name })
      .from(schema.person)
      .leftJoinLateral(latest, sql`true`)
      .leftJoinLateral(held, sql`true`)
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId))
      .where(eq(schema.person.id, payslip.personId))
      .limit(1),
    componentNamesOf(run.context as CalculationContext | null, payslip.entityId, run.month),
    listQueryThreads(payslipId),
  ]);

  return {
    payslip,
    run,
    entity,
    person: {
      id: payslip.personId,
      fullName: person?.fullName ?? "—",
      employeeCode: person?.employeeCode ?? null,
      positionName: person?.positionName ?? null,
      departmentName: person?.departmentName ?? null,
    },
    result: openResult(runPerson),
    componentNames,
    queries,
    isOwner: principal.personId === payslip.personId,
    manages: canManageCompensation(principal, { entityId: payslip.entityId }),
  };
}

/** Counts a reading by the payslip's owner. Never fails the page: this is a courtesy, not a control. */
export async function recordPayslipView(payslipId: string, personId: string): Promise<void> {
  const now = new Date();
  await db()
    .update(schema.payslip)
    .set({ firstViewedAt: sql`coalesce(${schema.payslip.firstViewedAt}, ${now.toISOString()}::timestamptz)`, lastViewedAt: now, viewCount: sql`${schema.payslip.viewCount} + 1` })
    .where(and(eq(schema.payslip.id, payslipId), eq(schema.payslip.personId, personId)));
}

export type RunPayslipRow = { payslipId: string | null; personId: string; fullName: string; employeeCode: string | null; publishedAt: Date | null; firstViewedAt: Date | null; openQueries: number };

/**
 * Who in a run has a payslip and who has read it — the C&B side of the release. The run screen
 * passes the names it already holds; the run's people come from the request's shared read.
 */
export async function listPayslipsOfRun(runId: string, names?: ReadonlyMap<string, { fullName: string; employeeCode: string | null }>): Promise<RunPayslipRow[]> {
  const [people, payslips, queries] = await Promise.all([
    loadRunPeople(runId),
    db().select().from(schema.payslip).where(eq(schema.payslip.runId, runId)),
    db()
      .select({ payslipId: schema.payslipQuery.payslipId, count: sql<number>`count(*)::int` })
      .from(schema.payslipQuery)
      .innerJoin(schema.payslip, eq(schema.payslip.id, schema.payslipQuery.payslipId))
      .where(and(eq(schema.payslip.runId, runId), inArray(schema.payslipQuery.status, ["open", "answered"])))
      .groupBy(schema.payslipQuery.payslipId),
  ]);
  if (people.length === 0) return [];

  const nameOf = names ?? new Map((await listPayrollNames(people.map((person) => person.row.personId))).map((row) => [row.personId, row]));
  const payslipOf = new Map(payslips.map((row) => [row.personId, row]));
  const openBy = new Map(queries.map((row) => [row.payslipId, row.count]));

  return people
    .map(({ row: person }) => {
      const payslip = payslipOf.get(person.personId);
      return {
        payslipId: payslip?.id ?? null,
        personId: person.personId,
        fullName: nameOf.get(person.personId)?.fullName ?? "—",
        employeeCode: nameOf.get(person.personId)?.employeeCode ?? null,
        publishedAt: payslip?.publishedAt ?? null,
        firstViewedAt: payslip?.firstViewedAt ?? null,
        openQueries: payslip ? (openBy.get(payslip.id) ?? 0) : 0,
      };
    })
    .sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName));
}

/**
 * The names the run's own component versions carried. A payslip from March must read the way it
 * read in March, even if a component has been renamed since (FR-PAY-20) — so the stored version
 * ids win, and today's catalogue is only the fallback for a run made before they were recorded.
 */
async function componentNamesOf(context: CalculationContext | null, entityId: string, month: string): Promise<ReadonlyMap<string, string>> {
  const versions = context?.componentVersionIds?.length ? await resolveCatalogueVersions(context.componentVersionIds).catch(() => []) : [];
  const rows = versions.length > 0 ? versions : await resolveCatalogue(entityId, `${month}-01` as `${number}-${number}-${number}`);
  return new Map(rows.map((row) => [row.code, row.name]));
}

// ── Payslip queries (FR-PAY-32) ─────────────────────────────────────────────────────────────

async function listQueryThreads(payslipId: string, executor: Executor = db()): Promise<PayslipQueryThread[]> {
  const queries = await executor.select().from(schema.payslipQuery).where(eq(schema.payslipQuery.payslipId, payslipId)).orderBy(desc(schema.payslipQuery.createdAt));
  if (queries.length === 0) return [];
  const messages = await executor
    .select({ message: schema.payslipQueryMessage, authorName: schema.person.fullName })
    .from(schema.payslipQueryMessage)
    .innerJoin(schema.person, eq(schema.person.id, schema.payslipQueryMessage.authorPersonId))
    .where(inArray(schema.payslipQueryMessage.queryId, queries.map((query) => query.id)))
    .orderBy(schema.payslipQueryMessage.createdAt);
  return queries.map((query) => ({ query, messages: messages.filter((row) => row.message.queryId === query.id).map((row) => ({ ...row.message, authorName: row.authorName })) }));
}

/** The payslip a query is about, for the actions' authorization check. */
export async function getPayslip(payslipId: string, executor: Executor = db()): Promise<PayslipRow | null> {
  const [row] = await executor.select().from(schema.payslip).where(eq(schema.payslip.id, payslipId)).limit(1);
  return row ?? null;
}

export async function getQuery(queryId: string, executor: Executor = db()): Promise<PayslipQueryRow | null> {
  const [row] = await executor.select().from(schema.payslipQuery).where(eq(schema.payslipQuery.id, queryId)).limit(1);
  return row ?? null;
}

/** The employee asks C&B about their payslip. Only the payslip's owner may (checked by the action). */
export async function raisePayslipQuery(input: { payslipId: string; body: string }, askerPersonId: string): Promise<PayslipQueryRow> {
  const { query, month } = await db().transaction(async (tx) => {
    const payslip = await getPayslip(input.payslipId, tx);
    if (!payslip) throw new ActionError("payslip_not_found");
    const [query] = await tx.insert(schema.payslipQuery).values({ payslipId: payslip.id, personId: payslip.personId, entityId: payslip.entityId }).returning();
    await tx.insert(schema.payslipQueryMessage).values({ queryId: query.id, authorPersonId: askerPersonId, body: input.body });
    return { query, month: payslip.month };
  });

  // C&B of that entity are told there is a question — the month and who asked, never the figures.
  await notify({
    recipients: await listCompensationManagers(query.entityId),
    kind: "payroll.payslip_query_raised",
    params: { month },
    link: `/payroll/queries`,
  });
  return query;
}

/** C&B answers, or the employee adds to the thread. `status` follows who spoke last. */
export async function replyToPayslipQuery(input: { queryId: string; body: string; fromManager: boolean }, authorPersonId: string): Promise<{ query: PayslipQueryRow; payslip: PayslipRow }> {
  const { query, payslip } = await db().transaction(async (tx) => {
    const [query] = await tx.select().from(schema.payslipQuery).where(eq(schema.payslipQuery.id, input.queryId)).limit(1).for("update");
    if (!query) throw new ActionError("query_not_found");
    if (query.status === "closed") throw new ActionError("query_closed");
    const payslip = await getPayslip(query.payslipId, tx);
    if (!payslip) throw new ActionError("payslip_not_found");
    await tx.insert(schema.payslipQueryMessage).values({ queryId: query.id, authorPersonId, body: input.body });
    const [updated] = await tx
      .update(schema.payslipQuery)
      .set({ status: input.fromManager ? "answered" : "open", answeredAt: input.fromManager ? new Date() : query.answeredAt, updatedAt: new Date() })
      .where(eq(schema.payslipQuery.id, query.id))
      .returning();
    return { query: updated, payslip };
  });

  if (input.fromManager) {
    await notify({ recipients: [query.personId], kind: "payroll.payslip_query_answered", params: { month: payslip.month }, link: `/payslips/${payslip.id}` });
  } else {
    await notify({ recipients: await listCompensationManagers(query.entityId), kind: "payroll.payslip_query_raised", params: { month: payslip.month }, link: "/payroll/queries" });
  }
  return { query, payslip };
}

/** Either side can close a settled question. */
export async function closePayslipQuery(queryId: string): Promise<PayslipQueryRow> {
  const [row] = await db().update(schema.payslipQuery).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.payslipQuery.id, queryId), inArray(schema.payslipQuery.status, ["open", "answered"]))).returning();
  if (!row) throw new ActionError("query_not_found");
  return row;
}

export type QueueRow = { query: PayslipQueryRow; payslip: PayslipRow; personName: string; entityCode: string; lastMessage: string; lastAt: Date };

/** C&B's queue: the questions waiting in the entities the viewer manages. Filtered in SQL. */
export async function listQueriesForManager(principal: Principal, includeClosed = false): Promise<QueueRow[]> {
  const reach = compensationReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await db()
    .select({ query: schema.payslipQuery, payslip: schema.payslip, personName: schema.person.fullName, entityCode: schema.entity.code })
    .from(schema.payslipQuery)
    .innerJoin(schema.payslip, eq(schema.payslip.id, schema.payslipQuery.payslipId))
    .innerJoin(schema.person, eq(schema.person.id, schema.payslipQuery.personId))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payslipQuery.entityId))
    .where(and(withinReach(schema.payslipQuery.entityId, reach), includeClosed ? undefined : inArray(schema.payslipQuery.status, ["open", "answered"])))
    .orderBy(desc(schema.payslipQuery.updatedAt))
    .limit(200);
  if (rows.length === 0) return [];

  // Only the last message of each thread: DISTINCT ON, newest first.
  const messages = await db()
    .selectDistinctOn([schema.payslipQueryMessage.queryId], { queryId: schema.payslipQueryMessage.queryId, body: schema.payslipQueryMessage.body, createdAt: schema.payslipQueryMessage.createdAt })
    .from(schema.payslipQueryMessage)
    .where(inArray(schema.payslipQueryMessage.queryId, rows.map((row) => row.query.id)))
    .orderBy(schema.payslipQueryMessage.queryId, desc(schema.payslipQueryMessage.createdAt));
  const lastOf = new Map(messages.map((message) => [message.queryId, message]));

  return rows.map((row) => ({ ...row, lastMessage: lastOf.get(row.query.id)?.body ?? "", lastAt: lastOf.get(row.query.id)?.createdAt ?? row.query.createdAt }));
}

/**
 * Who answers payslip questions for an entity: the people whose job it is. The owners' "*" is
 * left out on purpose — the same convention as every other routine notice in the system.
 */
async function listCompensationManagers(entityId: string): Promise<string[]> {
  return listPeopleHolding("payroll:propose", { entityId }, { includeWildcard: false });
}
