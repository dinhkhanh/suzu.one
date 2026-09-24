// The leave balance ledger (FR-LVE-02, 03, 07): every movement is a row, balances are sums.
// The daily job posts whatever the accrual engine says is due, closes leave years (carry-over,
// lapse), lapses carried days after their expiry date and pays out on termination.
import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type EmploymentFacts, listEmploymentFacts } from "@/modules/core-hr/service";
import { getParameter } from "@/modules/platform/statutory/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { accrualPostings, carryOverExpiryDate, carryOverLapse, terminationPayout, yearEndCarryOver } from "./engine/entitlement";
import { canSeeBalancesOf } from "./policy";
import { allLeaveTypes, type LeavePolicyRow, type LeaveTypeRow, leaveTypesFor, leaveTypesOf, listPolicies, policyOn, policyRules } from "./types";

type Executor = Tx | ReturnType<typeof db>;
export type LedgerEntryRow = typeof schema.leaveLedgerEntry.$inferSelect;
export type LedgerKind = LedgerEntryRow["kind"];
type NewEntry = Omit<typeof schema.leaveLedgerEntry.$inferInsert, "id" | "createdAt">;

/** Adds a row. With a `sourceKey`, a second posting of the same thing adds nothing and returns null. */
export async function postEntry(executor: Executor, entry: NewEntry): Promise<LedgerEntryRow | null> {
  if (entry.amountCenti === 0) return null;
  const [row] = await executor.insert(schema.leaveLedgerEntry).values(entry).onConflictDoNothing({ target: schema.leaveLedgerEntry.sourceKey }).returning();
  return row ?? null;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type Balance = {
  personId: string;
  leaveTypeId: string;
  code: string;
  name: string;
  nameEn: string | null;
  year: number;
  balanceCenti: number;
  /** Asked for by requests still waiting for an answer. */
  pendingCenti: number;
  availableCenti: number;
  /** Used this year (uses minus refunds), as a positive number. */
  usedCenti: number;
};

/** Balances of balance-tracked types, per person. Only types with a ledger row or a policy-less zero are listed when `types` is given. */
export async function getBalances(personIds: readonly string[], year: number, executor?: Executor): Promise<Map<string, Balance[]>> {
  const result = new Map<string, Balance[]>(personIds.map((id) => [id, []]));
  if (personIds.length === 0) return result;
  const ids = [...personIds];
  const from = executor ?? db();
  // Types come from the executor when one is given (a transaction), else from the shared cache.
  const [sums, pending, people, allTypes] = await Promise.all([
    from
      .select({
        personId: schema.leaveLedgerEntry.personId,
        leaveTypeId: schema.leaveLedgerEntry.leaveTypeId,
        balance: sql<number>`sum(${schema.leaveLedgerEntry.amountCenti})::int`,
        used: sql<number>`coalesce(-sum(${schema.leaveLedgerEntry.amountCenti}) filter (where ${schema.leaveLedgerEntry.kind} in ('use', 'refund')), 0)::int`,
      })
      .from(schema.leaveLedgerEntry)
      .where(and(inArray(schema.leaveLedgerEntry.personId, ids), eq(schema.leaveLedgerEntry.leaveYear, year)))
      .groupBy(schema.leaveLedgerEntry.personId, schema.leaveLedgerEntry.leaveTypeId),
    pendingByType(from, ids, year),
    from.select({ id: schema.person.id, entityId: schema.person.primaryEntityId }).from(schema.person).where(inArray(schema.person.id, ids)),
    allLeaveTypes(executor),
  ]);
  const sumOf = new Map(sums.map((row) => [`${row.personId}:${row.leaveTypeId}`, row]));
  const typesByEntity = new Map<string | null, LeaveTypeRow[]>();
  for (const person of people) {
    if (!typesByEntity.has(person.entityId)) typesByEntity.set(person.entityId, leaveTypesOf(allTypes, person.entityId, { includeInactive: true }));
    const rows: Balance[] = [];
    for (const type of typesByEntity.get(person.entityId)!) {
      const sum = sumOf.get(`${person.id}:${type.id}`);
      if (!type.tracksBalance || (!type.isActive && !sum)) continue;
      const pendingCenti = pending.get(`${person.id}:${type.id}`) ?? 0;
      const balanceCenti = sum?.balance ?? 0;
      rows.push({ personId: person.id, leaveTypeId: type.id, code: type.code, name: type.name, nameEn: type.nameEn, year, balanceCenti, pendingCenti, availableCenti: balanceCenti - pendingCenti, usedCenti: sum?.used ?? 0 });
    }
    result.set(person.id, rows);
  }
  return result;
}

/**
 * One person's balances **with the permission decision inside** — null when the reader may not
 * see them, which is the same answer as a person who does not exist.
 *
 * `getBalances` above takes ids and asks nothing; every screen that calls it has checked first.
 * The assistant (FR-AI-02) has no screen to check on, so this is its door: it is handed the
 * asker's own principal and `canSeeBalancesOf` decides, exactly as on /leave. Nothing here can be
 * called with more rights than the person who asked.
 */
export async function getLeaveBalanceFor(principal: Principal, subjectPersonId: string, year: number): Promise<Balance[] | null> {
  const [person] = await db()
    .select({ id: schema.person.id, entityId: schema.person.primaryEntityId, unitPath: schema.person.orgUnitPath, managerId: schema.person.managerId })
    .from(schema.person)
    .where(eq(schema.person.id, subjectPersonId))
    .limit(1);
  if (!person) return null;
  if (!canSeeBalancesOf(principal, { personId: person.id, entityId: person.entityId, unitPath: person.unitPath, managerId: person.managerId })) return null;
  return (await getBalances([subjectPersonId], year)).get(subjectPersonId) ?? [];
}

// Days asked for by requests the approval engine still holds (pending or returned for changes).
async function pendingByType(executor: Executor, personIds: string[], year: number): Promise<Map<string, number>> {
  const rows = await executor
    .select({ personId: schema.leaveRequest.personId, leaveTypeId: schema.leaveRequest.leaveTypeId, total: sql<number>`sum(${schema.leaveRequestDay.amountCenti})::int` })
    .from(schema.leaveRequestDay)
    .innerJoin(schema.leaveRequest, eq(schema.leaveRequest.id, schema.leaveRequestDay.requestId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.leaveRequest.approvalRequestId))
    .where(and(inArray(schema.leaveRequest.personId, personIds), eq(schema.leaveRequest.status, "pending"), inArray(schema.approvalRequest.status, ["pending", "returned"]), gte(schema.leaveRequestDay.date, `${year}-01-01`), lte(schema.leaveRequestDay.date, `${year}-12-31`)))
    .groupBy(schema.leaveRequest.personId, schema.leaveRequest.leaveTypeId);
  return new Map(rows.map((row) => [`${row.personId}:${row.leaveTypeId}`, row.total]));
}

export type LedgerLine = LedgerEntryRow & { typeCode: string; typeName: string; createdByName: string | null };

/** A person's ledger, newest first. Payroll reads `payout` rows from here too. */
export async function getLedger(personId: string, filter: { year?: number; leaveTypeId?: string } = {}, executor: Executor = db()): Promise<LedgerLine[]> {
  const rows = await executor
    .select({ entry: schema.leaveLedgerEntry, typeCode: schema.leaveType.code, typeName: schema.leaveType.name, createdByName: schema.person.fullName })
    .from(schema.leaveLedgerEntry)
    .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveLedgerEntry.leaveTypeId))
    .leftJoin(schema.person, eq(schema.person.id, schema.leaveLedgerEntry.createdByPersonId))
    .where(and(eq(schema.leaveLedgerEntry.personId, personId), filter.year ? eq(schema.leaveLedgerEntry.leaveYear, filter.year) : undefined, filter.leaveTypeId ? eq(schema.leaveLedgerEntry.leaveTypeId, filter.leaveTypeId) : undefined))
    .orderBy(desc(schema.leaveLedgerEntry.effectiveDate), desc(schema.leaveLedgerEntry.createdAt));
  return rows.map((row) => ({ ...row.entry, typeCode: row.typeCode, typeName: row.typeName, createdByName: row.createdByName }));
}

export type PayoutLine = { personId: string; leaveTypeId: string; typeCode: string; daysCenti: number; effectiveDate: IsoDate };

/** Unused days paid out on termination in a period — an input of the final payroll (FR-LVE-03). */
export async function listPayouts(entityId: string, from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<PayoutLine[]> {
  const rows = await executor
    .select({ entry: schema.leaveLedgerEntry, typeCode: schema.leaveType.code })
    .from(schema.leaveLedgerEntry)
    .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveLedgerEntry.leaveTypeId))
    .where(and(eq(schema.leaveLedgerEntry.entityId, entityId), eq(schema.leaveLedgerEntry.kind, "payout"), gte(schema.leaveLedgerEntry.effectiveDate, from), lte(schema.leaveLedgerEntry.effectiveDate, to)))
    .orderBy(asc(schema.leaveLedgerEntry.effectiveDate));
  return rows.map(({ entry, typeCode }) => ({ personId: entry.personId, leaveTypeId: entry.leaveTypeId, typeCode, daysCenti: -entry.amountCenti, effectiveDate: entry.effectiveDate }));
}

// ── HR's postings ───────────────────────────────────────────────────────────────────────────

/** A manual correction with a reason (FR-LVE-07). Positive adds days, negative takes them. */
export async function adjustBalance(input: { personId: string; leaveTypeId: string; year: number; amountCenti: number; reason: string; effectiveDate?: IsoDate }, actorPersonId: string): Promise<{ entry: LedgerEntryRow; balanceBefore: number; balanceAfter: number }> {
  return db().transaction(async (tx) => {
    const [[type], [person]] = await Promise.all([tx.select().from(schema.leaveType).where(eq(schema.leaveType.id, input.leaveTypeId)).limit(1), tx.select().from(schema.person).where(eq(schema.person.id, input.personId)).limit(1)]);
    if (!type || !person) throw new ActionError("leave_type_not_found");
    if (!type.tracksBalance) throw new ActionError("leave_type_keeps_no_balance");
    if (input.amountCenti === 0) throw new ActionError("leave_adjustment_zero");
    const balanceBefore = await balanceOf(tx, input.personId, input.leaveTypeId, input.year);
    const entry = await postEntry(tx, { personId: input.personId, entityId: person.primaryEntityId, leaveTypeId: input.leaveTypeId, leaveYear: input.year, kind: "adjustment", amountCenti: input.amountCenti, effectiveDate: input.effectiveDate ?? todayInVietnam(), reason: input.reason, createdByPersonId: actorPersonId });
    return { entry: entry!, balanceBefore, balanceAfter: balanceBefore + input.amountCenti };
  });
}

/**
 * Time off in lieu earned by overtime or holiday work (FR-ATT-12, 18): the attendance module posts
 * it here, inside its own transaction. `sourceKey` makes the posting idempotent.
 */
export async function postCompensatoryLeave(tx: Executor, input: { personId: string; amountCenti: number; effectiveDate: IsoDate; sourceKey: string; reason: string; actorPersonId: string | null }): Promise<LedgerEntryRow | null> {
  const [person] = await tx.select({ entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, input.personId)).limit(1);
  if (!person) throw new ActionError("person_not_found");
  const type = (await leaveTypesFor(person.entityId, tx)).find((row) => row.category === "compensatory" && row.tracksBalance);
  if (!type) throw new ActionError("leave_no_compensatory_type");
  return postEntry(tx, { personId: input.personId, entityId: person.entityId, leaveTypeId: type.id, leaveYear: Number(input.effectiveDate.slice(0, 4)), kind: "grant", amountCenti: input.amountCenti, effectiveDate: input.effectiveDate, sourceKey: `toil:${input.sourceKey}`, reason: input.reason, createdByPersonId: input.actorPersonId });
}

export async function balanceOf(executor: Executor, personId: string, leaveTypeId: string, year: number): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`coalesce(sum(${schema.leaveLedgerEntry.amountCenti}), 0)::int` })
    .from(schema.leaveLedgerEntry)
    .where(and(eq(schema.leaveLedgerEntry.personId, personId), eq(schema.leaveLedgerEntry.leaveTypeId, leaveTypeId), eq(schema.leaveLedgerEntry.leaveYear, year)));
  return row?.total ?? 0;
}

// ── The daily job ───────────────────────────────────────────────────────────────────────────

const sum = (rows: readonly LedgerEntryRow[], keep: (row: LedgerEntryRow) => boolean) => rows.filter(keep).reduce((total, row) => total + row.amountCenti, 0);
const GIVEN: LedgerKind[] = ["accrual", "grant"];

// Someone whose workforce type says "probation" but who has no probation contract on file is on
// probation from their first day until HR changes the type. Leave is earned from the start of
// continuous service: a move to another entity neither restarts the year's accrual nor pays out.
export function engineFacts(facts: EmploymentFacts) {
  const probation = facts.probation.length === 0 && facts.workforceType === "probation" && facts.startDate ? [{ start: facts.startDate, end: null }] : facts.probation;
  const startDate = facts.serviceStartDate ?? facts.startDate!;
  return { startDate, seniorityDate: facts.seniorityDate ?? startDate, endDate: facts.endDate, probation };
}

/**
 * Brings every balance up to `today`. Safe to run any number of times: accruals are the
 * difference between the engine's target and what the ledger already holds, and the one-off
 * postings (year end, lapse, payout) carry a source key.
 */
export async function runLeaveAccruals(today: IsoDate = todayInVietnam(), options: { personIds?: readonly string[] } = {}): Promise<{ people: number; accruals: number; yearsClosed: number; lapsed: number; payouts: number }> {
  const year = Number(today.slice(0, 4));
  const everyone = await listEmploymentFacts(options.personIds ? { personIds: options.personIds } : {});
  // People on the books this year or last; the rest have nothing left to post.
  const people = everyone.filter((facts) => facts.startDate && facts.startDate <= today && (!facts.endDate || facts.endDate >= `${year - 1}-01-01`));
  const counts = { people: people.length, accruals: 0, yearsClosed: 0, lapsed: 0, payouts: 0 };
  if (people.length === 0) return counts;

  const [policies, current, previous, allTypes] = await Promise.all([listPolicies(undefined, db()), getParameter("leave.annual", today), getParameter("leave.annual", `${year - 1}-12-31`).catch(() => null), allLeaveTypes(db())]);
  const statutory: Record<number, typeof current | null> = { [year - 1]: previous, [year]: current };
  const typesByEntity = new Map<string | null, LeaveTypeRow[]>();

  for (const facts of people) {
    if (!typesByEntity.has(facts.entityId)) typesByEntity.set(facts.entityId, leaveTypesOf(allTypes, facts.entityId, { includeInactive: true }).filter((type) => type.tracksBalance));
    for (const type of typesByEntity.get(facts.entityId)!) {
      await db().transaction(async (tx) => {
        const entries = await tx.select().from(schema.leaveLedgerEntry).where(and(eq(schema.leaveLedgerEntry.personId, facts.personId), eq(schema.leaveLedgerEntry.leaveTypeId, type.id), gte(schema.leaveLedgerEntry.leaveYear, year - 1)));
        const post = async (entry: Pick<NewEntry, "leaveYear" | "kind" | "amountCenti" | "effectiveDate" | "sourceKey" | "reason">) => {
          const row = await postEntry(tx, { personId: facts.personId, entityId: facts.entityId, leaveTypeId: type.id, createdByPersonId: null, ...entry });
          if (row) entries.push(row);
          return row;
        };
        const key = (what: string, ...parts: (string | number)[]) => [what, facts.personId, type.id, ...parts].join(":");

        // 1. Last year, once: finish its accrual, then carry over and lapse.
        const lastYear = entries.filter((row) => row.leaveYear === year - 1);
        const closingPolicy = policyOn(policies, type.id, facts.entityId, `${year - 1}-12-31`);
        if (lastYear.length > 0 && closingPolicy && statutory[year - 1] && !lastYear.some((row) => row.sourceKey === key("carry-out", year - 1))) {
          counts.accruals += await accrue(facts, type, policies, statutory[year - 1]!, year - 1, `${year - 1}-12-31`, entries, post, key);
          const closing = sum(entries, (row) => row.leaveYear === year - 1);
          const { carryCenti, expireCenti } = yearEndCarryOver(closing, policyRules(closingPolicy));
          // An ended employment carries nothing into a year it does not reach.
          const reachesThisYear = !facts.endDate || facts.endDate >= `${year}-01-01`;
          if (reachesThisYear && closing !== 0) {
            if (expireCenti) await post({ leaveYear: year - 1, kind: "expiry", amountCenti: -expireCenti, effectiveDate: `${year - 1}-12-31`, sourceKey: key("year-end-expiry", year - 1), reason: "Hết hạn cuối năm (vượt mức chuyển năm)" });
            await post({ leaveYear: year - 1, kind: "carry_over", amountCenti: -carryCenti, effectiveDate: `${year - 1}-12-31`, sourceKey: key("carry-out", year - 1), reason: `Chuyển sang năm ${year}` });
            await post({ leaveYear: year, kind: "carry_over", amountCenti: carryCenti, effectiveDate: `${year}-01-01`, sourceKey: key("carry-in", year), reason: `Chuyển từ năm ${year - 1}` });
            counts.yearsClosed++;
          }
        }

        // 2. This year's accruals up to today.
        counts.accruals += await accrue(facts, type, policies, current, year, today, entries, post, key);

        // 3. Carried days that were not used by their expiry date lapse.
        const policy = policyOn(policies, type.id, facts.entityId, today);
        const carried = sum(entries, (row) => row.leaveYear === year && row.kind === "carry_over");
        const expiresOn = policy ? carryOverExpiryDate(year, policy.carryOverExpiry) : null;
        if (expiresOn && today > expiresOn && carried > 0) {
          const usedByExpiry = -sum(entries, (row) => row.leaveYear === year && (row.kind === "use" || row.kind === "refund") && row.effectiveDate <= expiresOn);
          const lapse = carryOverLapse({ carriedCenti: carried, usedByExpiryCenti: usedByExpiry, balanceCenti: sum(entries, (row) => row.leaveYear === year) });
          if (lapse > 0 && (await post({ leaveYear: year, kind: "expiry", amountCenti: -lapse, effectiveDate: expiresOn, sourceKey: key("carry-lapse", year), reason: "Ngày phép chuyển năm hết hạn" }))) counts.lapsed++;
        }

        // 4. Employment over: pay out what is left, once per employment.
        if (policy && facts.endDate && facts.endDate < today && facts.employmentId) {
          const endYear = Number(facts.endDate.slice(0, 4));
          const payout = terminationPayout(sum(entries, (row) => row.leaveYear === endYear), policyRules(policy));
          if (payout > 0 && (await post({ leaveYear: endYear, kind: "payout", amountCenti: -payout, effectiveDate: facts.endDate, sourceKey: key("payout", facts.employmentId), reason: "Thanh toán ngày phép chưa nghỉ khi nghỉ việc" }))) counts.payouts++;
        }
      });
    }
  }
  return counts;
}

type Post = (entry: Pick<NewEntry, "leaveYear" | "kind" | "amountCenti" | "effectiveDate" | "sourceKey" | "reason">) => Promise<LedgerEntryRow | null>;

// One row per checkpoint at which something became due (see `accrualPostings`), so that the ledger
// reads like a calendar even when the job catches up on several months at once. After a payout
// nothing more is given.
async function accrue(facts: EmploymentFacts, type: LeaveTypeRow, policies: readonly LeavePolicyRow[], statutory: { baseDays: number; yearsOfServicePerExtraDay: number }, year: number, asOf: IsoDate, entries: LedgerEntryRow[], post: Post, key: (what: string, ...parts: (string | number)[]) => string): Promise<number> {
  if (entries.some((row) => row.kind === "payout")) return 0;
  // Leave the person's kind of employment does not have is not earned either.
  if (type.eligibleWorkforceTypes && !type.eligibleWorkforceTypes.includes(facts.workforceType)) return 0;
  const opening = entries.filter((row) => row.leaveYear === year && row.kind === "opening").map((row) => row.effectiveDate).sort().at(-1) ?? null;
  const postings = accrualPostings({
    year,
    asOf,
    statutory,
    employment: engineFacts(facts),
    openingDate: opening,
    policyAt: (date) => {
      const policy = policyOn(policies, type.id, facts.entityId, date);
      return policy ? policyRules(policy) : null;
    },
    given: entries.filter((row) => row.leaveYear === year && GIVEN.includes(row.kind)),
  });
  let posted = 0;
  for (const posting of postings) {
    if (await post({ leaveYear: year, kind: posting.kind, amountCenti: posting.amountCenti, effectiveDate: posting.effectiveDate, sourceKey: key(posting.kind, year, posting.effectiveDate), reason: posting.trace.join("; ") })) posted++;
  }
  return posted;
}
