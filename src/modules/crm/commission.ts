// Sales commission (FR-CRM-45): a scheme the owner approves, a monthly statement per person with
// its trace, and — once C&B confirm a statement — the amount in the person's payroll run as the
// COMMISSION input. Never automatic: nothing is computed while no approved scheme covers the month,
// and nothing reaches payroll until a person confirms it.
//
// Compensation tier throughout. A statement's amount and trace are sealed with the field cipher
// like payroll's figures, nothing here is cached except the schemes (rules, not anybody's pay),
// and a statement is read only by its person, by C&B over their employer (`payroll:propose`), and
// by the owner. Line managers hold none of that, so they see none of it.
//
// Payroll is reached only through its service, the way approved expense claims are: the person's
// line in a run is the sum of every statement posted to that run, one input and not one per
// statement, because `payroll_run_input` is keyed by (run, person, component).
import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { fieldCipher } from "@/lib/crypto";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { can, entityReach, type Principal } from "../platform/rbac/policy";
import { canManageCompensation, canViewCompensationOf, findOpenRegularRun, getRunHandle, removeRunInput, setRunInput } from "@/modules/payroll/service";
import { type Collection, type CommissionTrace, commissionStatements, ruleProblem } from "./engine/commission";
import { monthEnd } from "./engine/contract";
import type { CommissionRule } from "./schema";

type Executor = Tx | ReturnType<typeof db>;
export type CommissionSchemeRow = typeof schema.crmCommissionScheme.$inferSelect;
export type CommissionStatementRow = typeof schema.crmCommissionStatement.$inferSelect;

/** The pay component commission is paid under (seeded with the payroll catalogue). */
export const COMMISSION_COMPONENT = "COMMISSION";

const amountContext = (id: string) => `crm_commission_statement.amount:${id}`;
const traceContext = (id: string) => `crm_commission_statement.trace:${id}`;

// ── Who may ─────────────────────────────────────────────────────────────────────────────────

/** Proposes a scheme: the sales director (group `crm:manage`) or whoever proposes pay rules. */
export const canProposeCommissionScheme = (principal: Principal): boolean => can(principal, "crm:manage", { entityId: null }) || can(principal, "rules:propose", {});
/** Decides one: the owner, who decides pay rules (`payroll:rules`) — the bonus scheme's rule. */
export const canDecideCommissionScheme = (principal: Principal): boolean => can(principal, "payroll:rules", {});
/** Works out and confirms statements: C&B over somebody's employer. */
export const canRunCommission = (principal: Principal): boolean => {
  const reach = entityReach(principal, "payroll:propose");
  return reach.all || reach.entityIds.length > 0;
};

// ── Schemes: reference data, one cache key ──────────────────────────────────────────────────

const SCHEMES_KEY = "crm:commission-schemes";

/** Every scheme, newest first by start (then by id, so the cached array is always the same). */
export async function listCommissionSchemes(executor?: Executor): Promise<CommissionSchemeRow[]> {
  const read = (from: Executor) => from.select().from(schema.crmCommissionScheme).orderBy(sql`${schema.crmCommissionScheme.validFrom} desc`, asc(schema.crmCommissionScheme.id));
  return executor && executor !== db() ? read(executor) : cached(SCHEMES_KEY, TTL.reference, () => read(db()));
}

export const invalidateCommissionSchemes = () => invalidate(SCHEMES_KEY);

/** The approved scheme that covers an entity's invoices on a day: the entity's own, else the group's. */
export function schemeFor(schemes: readonly CommissionSchemeRow[], entityId: string | null, on: IsoDate): CommissionSchemeRow | null {
  const live = schemes.filter((scheme) => scheme.status === "approved" && scheme.validFrom <= on && (!scheme.validTo || scheme.validTo >= on));
  return live.find((scheme) => entityId && scheme.entityId === entityId) ?? live.find((scheme) => scheme.entityId === null) ?? null;
}

export type SchemeInput = { entityId: string | null; name: string; rule: CommissionRule; validFrom: IsoDate };

export async function proposeCommissionScheme(input: SchemeInput, actorPersonId: string): Promise<CommissionSchemeRow> {
  const problem = ruleProblem(input.rule);
  if (problem) throw new ActionError(problem);
  const [row] = await db()
    .insert(schema.crmCommissionScheme)
    .values({ entityId: input.entityId, name: input.name, rule: { ...input.rule, tiers: [...input.rule.tiers].sort((a, b) => a.fromVnd - b.fromVnd) }, validFrom: input.validFrom, status: "proposed", proposedByPersonId: actorPersonId })
    .returning();
  await invalidateCommissionSchemes();
  return row;
}

/**
 * The owner approves or rejects a proposed scheme. Approving closes the scheme it replaces (same
 * entity, still open, starting earlier) the day before this one starts; a month already stated
 * under the old scheme keeps its statements.
 */
export async function decideCommissionScheme(schemeId: string, decision: "approved" | "rejected", actorPersonId: string): Promise<{ before: CommissionSchemeRow; after: CommissionSchemeRow }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmCommissionScheme).where(eq(schema.crmCommissionScheme.id, schemeId)).for("update").limit(1);
    if (!before) throw new ActionError("commission_scheme_not_found");
    if (before.status !== "proposed") throw new ActionError("commission_scheme_decided");
    if (decision === "approved") {
      await tx
        .update(schema.crmCommissionScheme)
        .set({ validTo: addDays(before.validFrom, -1), updatedAt: new Date() })
        .where(
          and(
            eq(schema.crmCommissionScheme.status, "approved"),
            before.entityId ? eq(schema.crmCommissionScheme.entityId, before.entityId) : isNull(schema.crmCommissionScheme.entityId),
            sql`${schema.crmCommissionScheme.validFrom} < ${before.validFrom}`,
            or(isNull(schema.crmCommissionScheme.validTo), sql`${schema.crmCommissionScheme.validTo} >= ${before.validFrom}`),
          ),
        );
    }
    const [after] = await tx.update(schema.crmCommissionScheme).set({ status: decision, decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crmCommissionScheme.id, schemeId)).returning();
    return { before, after };
  });
  await invalidateCommissionSchemes();
  return result;
}

// ── Statements ──────────────────────────────────────────────────────────────────────────────

/**
 * The month's cash, one row per billing item of each payment: what the engine shares out. Read as
 * rows because every one of them is a line of somebody's trace.
 */
async function collectionsOf(month: string, executor: Executor): Promise<(Collection & { entityId: string | null })[]> {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const account = sql`coalesce(${schema.workClient.parentId}, ${schema.workClient.id})`;
  const acct = alias(schema.workClient, "acct");
  const rows = await executor
    .select({
      paymentId: schema.crmPayment.id,
      invoiceId: schema.crmInvoice.id,
      invoiceNumber: schema.crmInvoice.number,
      entityId: schema.crmInvoice.entityId,
      accountName: acct.name,
      receivedOn: schema.crmPayment.receivedOn,
      paidVnd: schema.crmPayment.amountVnd,
      invoiceSubtotalVnd: schema.crmInvoice.subtotalVnd,
      invoiceTotalVnd: schema.crmInvoice.totalVnd,
      itemVnd: sql<number>`coalesce(${schema.projectBillingItem.amountVnd}, 0)`,
      itemsVnd: sql<number>`sum(coalesce(${schema.projectBillingItem.amountVnd}, 0)) over (partition by ${schema.crmPayment.id})`,
      dealOwnerId: sql<string | null>`coalesce(${schema.crmDeal.ownerPersonId}, ${schema.crmAccount.salesOwnerPersonId})`,
      accountManagerId: acct.accountManagerPersonId,
    })
    .from(schema.crmPayment)
    .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
    .innerJoin(schema.crmInvoiceItem, eq(schema.crmInvoiceItem.invoiceId, schema.crmInvoice.id))
    .innerJoin(schema.projectBillingItem, eq(schema.projectBillingItem.id, schema.crmInvoiceItem.billingItemId))
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
    .innerJoin(acct, sql`${acct.id} = ${account}`)
    .leftJoin(schema.crmAccount, sql`${schema.crmAccount.clientId} = ${account}`)
    .leftJoin(schema.crmDealProject, eq(schema.crmDealProject.projectId, schema.projectBillingItem.projectId))
    .leftJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealProject.dealId))
    .where(sql`${schema.crmPayment.receivedOn} between ${from}::date and ${to}::date`)
    .orderBy(asc(schema.crmPayment.receivedOn), asc(schema.crmPayment.id), asc(schema.crmInvoiceItem.billingItemId));
  return rows.map((row) => ({ ...row, paidVnd: Number(row.paidVnd), invoiceSubtotalVnd: Number(row.invoiceSubtotalVnd), invoiceTotalVnd: Number(row.invoiceTotalVnd), itemVnd: Number(row.itemVnd), itemsVnd: Number(row.itemsVnd) }));
}

const seal = (id: string, trace: CommissionTrace) => ({ amountEnc: fieldCipher().encrypt(String(trace.amountVnd), amountContext(id)), traceEnc: fieldCipher().encrypt(JSON.stringify(trace), traceContext(id)) });
export const openAmount = (row: Pick<CommissionStatementRow, "id" | "amountEnc">): number => Number(fieldCipher().decrypt(row.amountEnc, amountContext(row.id)));
export const openTrace = (row: Pick<CommissionStatementRow, "id" | "traceEnc">): CommissionTrace => JSON.parse(fieldCipher().decrypt(row.traceEnc, traceContext(row.id))) as CommissionTrace;

export type ComputeResult = { schemes: number; written: number; kept: number; removed: number };

/**
 * Works out a month's statements afresh, as drafts, for the invoices of the entities with an
 * approved scheme that month. A confirmed statement, or one already in payroll, is kept as it is:
 * C&B decided it. A draft whose person no longer earns anything is removed.
 */
export async function computeCommission(month: string): Promise<ComputeResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ActionError("commission_month");
  const schemes = await listCommissionSchemes();
  const on = monthEnd(`${month}-01`);
  const result: ComputeResult = { schemes: 0, written: 0, kept: 0, removed: 0 };
  await db().transaction(async (tx) => {
    const collections = await collectionsOf(month, tx);
    const byScheme = new Map<string, { scheme: CommissionSchemeRow; entityId: string | null; rows: Collection[] }>();
    for (const row of collections) {
      const scheme = schemeFor(schemes, row.entityId, on);
      if (!scheme) continue;
      const key = `${scheme.id}|${row.entityId ?? ""}`;
      const group = byScheme.get(key) ?? { scheme, entityId: row.entityId, rows: [] };
      group.rows.push(row);
      byScheme.set(key, group);
    }
    result.schemes = new Set([...byScheme.values()].map((group) => group.scheme.id)).size;
    const existing = await tx.select().from(schema.crmCommissionStatement).where(eq(schema.crmCommissionStatement.month, month));
    const seen = new Set<string>();
    for (const group of byScheme.values()) {
      const statements = commissionStatements({ id: group.scheme.id, name: group.scheme.name, rule: group.scheme.rule }, month, group.rows);
      for (const [personId, trace] of statements) {
        const key = `${personId}|${group.entityId ?? ""}`;
        seen.add(key);
        const current = existing.find((row) => row.personId === personId && (row.entityId ?? "") === (group.entityId ?? ""));
        if (current && current.status !== "draft") {
          result.kept += 1;
          continue;
        }
        const id = current?.id ?? crypto.randomUUID();
        const sealed = seal(id, trace);
        if (current) await tx.update(schema.crmCommissionStatement).set({ ...sealed, schemeId: group.scheme.id, updatedAt: new Date() }).where(eq(schema.crmCommissionStatement.id, id));
        else await tx.insert(schema.crmCommissionStatement).values({ id, personId, entityId: group.entityId, month, schemeId: group.scheme.id, ...sealed });
        result.written += 1;
      }
    }
    const stale = existing.filter((row) => row.status === "draft" && !seen.has(`${row.personId}|${row.entityId ?? ""}`)).map((row) => row.id);
    if (stale.length) await tx.delete(schema.crmCommissionStatement).where(inArray(schema.crmCommissionStatement.id, stale));
    result.removed = stale.length;
  });
  return result;
}

export type StatementView = { row: CommissionStatementRow; personName: string; employerEntityId: string | null; amountVnd: number; trace: CommissionTrace | null; canConfirm: boolean };

/**
 * The statements of a month the reader may open: their own, and — for C&B — those of the people
 * they manage compensation for. Decrypted here, never cached. `withTrace` opens the lines too.
 */
export async function listCommissionStatements(principal: Principal, month: string, options: { withTrace?: boolean } = {}): Promise<StatementView[]> {
  const reach = entityReach(principal, "payroll:propose");
  const me = principal.personId;
  const rows = await db()
    .select({ row: schema.crmCommissionStatement, personName: schema.person.fullName, employerEntityId: schema.person.primaryEntityId })
    .from(schema.crmCommissionStatement)
    .innerJoin(schema.person, eq(schema.person.id, schema.crmCommissionStatement.personId))
    .where(
      and(
        eq(schema.crmCommissionStatement.month, month),
        reach.all ? undefined : or(me ? eq(schema.crmCommissionStatement.personId, me) : undefined, reach.entityIds.length ? inArray(schema.person.primaryEntityId, reach.entityIds) : undefined) ?? sql`false`,
      ),
    )
    .orderBy(asc(schema.person.fullName), asc(schema.crmCommissionStatement.id));
  return rows
    .filter((item) => canViewCompensationOf(principal, { personId: item.row.personId, entityId: item.employerEntityId }))
    .map((item) => ({
      ...item,
      amountVnd: openAmount(item.row),
      trace: options.withTrace ? openTrace(item.row) : null,
      canConfirm: item.row.status === "draft" && !!item.employerEntityId && canManageCompensation(principal, { entityId: item.employerEntityId }),
    }));
}

/** The person's line in a run: every statement posted to it, summed — or no line when there is none. */
async function rewriteRunInput(tx: Tx, runId: string, personId: string, actorPersonId: string): Promise<void> {
  const run = await getRunHandle(runId, tx);
  if (!run || !run.openForEditing) return;
  const posted = await tx.select().from(schema.crmCommissionStatement).where(and(eq(schema.crmCommissionStatement.payrollRunId, runId), eq(schema.crmCommissionStatement.personId, personId), eq(schema.crmCommissionStatement.status, "in_payroll")));
  const total = posted.reduce((sum, row) => sum + openAmount(row), 0);
  if (total <= 0) {
    await removeRunInput(runId, personId, COMMISSION_COMPONENT, tx);
    return;
  }
  await setRunInput({ runId, personId, code: COMMISSION_COMPONENT, amount: total, note: `Hoa hồng ${[...new Set(posted.map((row) => row.month))].sort().join(", ")}` }, actorPersonId, tx);
}

/** Puts a confirmed statement in its person's employer's open regular run, if there is one. */
async function post(tx: Tx, row: CommissionStatementRow, employerEntityId: string | null, actorPersonId: string): Promise<boolean> {
  if (!employerEntityId) return false;
  const run = await findOpenRegularRun(employerEntityId, tx);
  if (!run) return false;
  await tx.update(schema.crmCommissionStatement).set({ status: "in_payroll", payrollRunId: run.id, updatedAt: new Date() }).where(eq(schema.crmCommissionStatement.id, row.id));
  await rewriteRunInput(tx, run.id, row.personId, actorPersonId);
  return true;
}

/**
 * C&B confirm a draft: it is final for the month, the person is told, and it goes into their
 * employer's open payroll run — or waits for the next one (`postConfirmedCommissions`).
 */
export async function confirmStatement(statementId: string, principal: Principal, actorPersonId: string): Promise<{ before: CommissionStatementRow; after: CommissionStatementRow; posted: boolean }> {
  return db().transaction(async (tx) => {
    const [found] = await tx
      .select({ row: schema.crmCommissionStatement, employerEntityId: schema.person.primaryEntityId })
      .from(schema.crmCommissionStatement)
      .innerJoin(schema.person, eq(schema.person.id, schema.crmCommissionStatement.personId))
      .where(eq(schema.crmCommissionStatement.id, statementId))
      .for("update", { of: schema.crmCommissionStatement })
      .limit(1);
    if (!found) throw new ActionError("commission_statement_not_found");
    if (!found.employerEntityId || !canManageCompensation(principal, { entityId: found.employerEntityId })) throw new ActionError("forbidden");
    if (found.row.status !== "draft") throw new ActionError("commission_statement_confirmed");
    await tx.update(schema.crmCommissionStatement).set({ status: "confirmed", confirmedByPersonId: actorPersonId, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crmCommissionStatement.id, statementId));
    const posted = await post(tx, { ...found.row, status: "confirmed" }, found.employerEntityId, actorPersonId);
    // Generic wording, like every notice about pay: the month, never the amount.
    await notify({ recipients: [found.row.personId], kind: "crm.commission_ready", params: { month: found.row.month }, link: `/crm/commission?month=${found.row.month}` }, tx);
    const [after] = await tx.select().from(schema.crmCommissionStatement).where(eq(schema.crmCommissionStatement.id, statementId));
    return { before: found.row, after, posted };
  });
}

/**
 * Confirmed statements not yet in a live run, offered to payroll again: those that found no open
 * run when confirmed, and those whose run was cancelled. Idempotent; the nightly job runs it.
 */
export async function postConfirmedCommissions(actorPersonId: string | null): Promise<{ posted: number; released: number }> {
  const candidates = await db()
    .select({ row: schema.crmCommissionStatement, employerEntityId: schema.person.primaryEntityId, runStatus: schema.payrollRun.status })
    .from(schema.crmCommissionStatement)
    .innerJoin(schema.person, eq(schema.person.id, schema.crmCommissionStatement.personId))
    .leftJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.crmCommissionStatement.payrollRunId))
    .where(or(eq(schema.crmCommissionStatement.status, "confirmed"), and(eq(schema.crmCommissionStatement.status, "in_payroll"), eq(schema.payrollRun.status, "cancelled"))));
  const result = { posted: 0, released: 0 };
  for (const candidate of candidates) {
    await db().transaction(async (tx) => {
      const actor = actorPersonId ?? candidate.row.confirmedByPersonId ?? candidate.row.personId;
      let row = candidate.row;
      if (row.status === "in_payroll") {
        [row] = await tx.update(schema.crmCommissionStatement).set({ status: "confirmed", payrollRunId: null, updatedAt: new Date() }).where(eq(schema.crmCommissionStatement.id, row.id)).returning();
        result.released += 1;
      }
      if (await post(tx, row, candidate.employerEntityId, actor)) result.posted += 1;
    });
  }
  return result;
}

/** The months with statements, newest first — the month picker's choices. Grouped in SQL. */
export async function commissionMonths(principal: Principal): Promise<string[]> {
  const me = principal.personId;
  const reach = entityReach(principal, "payroll:propose");
  const rows = await db()
    .selectDistinct({ month: schema.crmCommissionStatement.month })
    .from(schema.crmCommissionStatement)
    .innerJoin(schema.person, eq(schema.person.id, schema.crmCommissionStatement.personId))
    .where(reach.all ? undefined : (or(me ? eq(schema.crmCommissionStatement.personId, me) : undefined, reach.entityIds.length ? inArray(schema.person.primaryEntityId, reach.entityIds) : undefined) ?? sql`false`))
    .orderBy(sql`${schema.crmCommissionStatement.month} desc`)
    .limit(24);
  return rows.map((row) => row.month);
}
