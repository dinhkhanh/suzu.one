// The CRM's correction paths against a real Postgres (PGlite): a won deal set up for delivery twice
// at once makes one project (CRM-04); an invoice prepared as a draft, changed, issued, voided; a
// payment refused above what is owed and reversed rather than deleted; and a payment changed after
// its month's commission was confirmed reaching the statement (CRM-05).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { workflow } from "../../../tests/helpers/workflows";
import type { Grant, Principal } from "../platform/rbac/policy";
import { createManualBillingItem } from "../projects/billing";
import { createTeam } from "../work/teams";
import { createAccount } from "./accounts";
import { computeCommission, confirmStatement, decideCommissionScheme, listCommissionStatements, postConfirmedCommissions, proposeCommissionScheme } from "./commission";
import { createDeal } from "./deals";
import { setUpDelivery } from "./delivery";
import { deleteDraftInvoice, findInvoice, getInvoice, heldBillingItemIds, issueInvoice, listInvoices, recordInvoice, recordPayment, reversePayment, saveDraftInvoice, voidInvoice } from "./invoices";
import type { CrmViewer } from "./policy";
import { seedStages } from "./seed";
import { firstStageOf, listStages } from "./stages";

const ids = {} as Record<"szm" | "seller" | "lead" | "finance" | "cb" | "team" | "account" | "deal" | "project", string>;
const today = todayInVietnam();
const month = today.slice(0, 7);
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error & { details?: unknown }) => error,
  );
const noticesOf = async (personId: string, kind: string) =>
  db()
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const grantsOf: Record<string, Grant[]> = {};
const principalOf = (personId: string): Principal => ({ personId, workforceType: "employee", grants: grantsOf[personId] ?? [] });
const finance = (): CrmViewer => ({ principal: principalOf(ids.finance), ties: new Map() });
const item = async (description: string, amountVnd: number | null) => (await createManualBillingItem(ids.project, { description, reference: null, amountVnd }, ids.finance)).id;
const billing = async (itemId: string) => (await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, itemId)))[0];

beforeAll(async () => {
  await migrateTestDb();
  await db().insert(schema.payComponent).values({ code: "COMMISSION", name: "Hoa hồng", kind: "earning", category: "commission", source: "input", validFrom: "2026-01-01", status: "approved" });
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["seller", "lead", "finance", "cb"] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id })
      .returning();
    ids[key] = row.id;
  }
  await db()
    .insert(schema.roleAssignment)
    .values([
      { personId: ids.seller, role: "sales", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
      { personId: ids.finance, role: "finance", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
    ]);
  grantsOf[ids.finance] = [{ role: "finance", scope: { type: "entity", id: szm.id } }];
  grantsOf[ids.cb] = [{ role: "payroll", scope: { type: "entity", id: szm.id } }];
  await db()
    .insert(schema.statutoryParameter)
    .values([
      {
        key: "crm.settings",
        validFrom: "2021-01-01",
        value: { staleDealDays: 14, renewalLeadDays: 45, receivableReminderDays: [1, 15, 30], defaultPaymentTermsDays: 30, quoteValidityDays: 30, quoteDiscountApprovalBp: 1000, quoteMarginFloorBp: 3000 },
        status: "approved",
        isVerified: false,
        legalReference: "test",
      },
      { key: "tax.vat", validFrom: "2021-01-01", value: { defaultBp: 1000, allowedBp: [0, 800, 1000] }, status: "approved", isVerified: false, legalReference: "test" },
    ]);
  await seedStages(db() as never);
  const team = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.lead);
  ids.team = team.id;
  const { client } = await createAccount({
    code: "VNM",
    name: "Vinamilk",
    entityId: szm.id,
    note: null,
    profile: { legalName: null, taxCode: null, address: null, website: null, industry: null, size: null, source: null, tier: null, contractingEntityId: szm.id },
    salesOwnerPersonId: ids.seller,
    accountManagerPersonId: null,
    confirmDuplicate: false,
  });
  ids.account = client.id;
  const deal = await createDeal(
    {
      clientId: client.id,
      title: "Tết 2027",
      brandId: null,
      serviceLines: ["video"],
      oneOffVnd: 100_000_000,
      monthlyVnd: null,
      months: null,
      probability: null,
      expectedCloseOn: null,
      teamId: team.id,
      entityId: szm.id,
      source: null,
      competitors: null,
      nextStep: null,
      ownerPersonId: ids.seller,
      stageId: null,
      leadId: null,
      contacts: [],
    },
    ids.seller,
  );
  ids.deal = deal.id;
  // Won, as the pipeline would leave it: setting up delivery asks only that.
  const won = firstStageOf(await listStages(), "won")!;
  await db().update(schema.crmDeal).set({ status: "won", stageId: won.id, wonAt: new Date() }).where(eq(schema.crmDeal.id, deal.id));
});

describe("setting a won deal up for delivery (CRM-04)", () => {
  const setup = (name: string) => setUpDelivery(ids.deal, { teamId: ids.team, leadPersonId: ids.lead, name, templateId: null, startDate: today, dueDate: null, visibility: "team", contractId: null, note: { context: "Won" } }, ids.seller);
  const projectsOfDeal = () =>
    db()
      .select({ projectId: schema.crmDealProject.projectId, name: schema.workProject.name })
      .from(schema.crmDealProject)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.crmDealProject.projectId))
      .where(eq(schema.crmDealProject.dealId, ids.deal));

  it("makes one project when the same set-up is sent twice at once", async () => {
    const results = await Promise.allSettled([setup("Vinamilk — Tết 2027"), setup("Vinamilk — Tết 2027")]);
    const made = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(made).toHaveLength(1);
    expect(refused.map((result) => (result.reason as Error).message)).toEqual(["delivery_exists"]);
    const projects = await projectsOfDeal();
    expect(projects).toHaveLength(1);
    ids.project = projects[0].projectId;
    // Nothing of the refused one is left behind: one project of that name, one hand-off notice.
    expect(await db().select().from(schema.workProject).where(eq(schema.workProject.name, "Vinamilk — Tết 2027"))).toHaveLength(1);
    expect(await noticesOf(ids.lead, "crm.delivery_handoff")).toHaveLength(1);
  });

  it("refuses it sent again later — spaces and case aside — and names the project it already made", async () => {
    const again = await failure(setup("  vinamilk — tết 2027 "));
    expect(again?.message).toBe("delivery_exists");
    expect(again?.details).toEqual({ projectId: ids.project });
  });

  it("still makes a second project of another name: a deal may become several", async () => {
    await setup("Vinamilk — retainer");
    expect((await projectsOfDeal()).map((row) => row.name).sort()).toEqual(["Vinamilk — Tết 2027", "Vinamilk — retainer"]);
  });
});

describe("correcting invoices (CRM-05)", () => {
  it("prepares a draft without a number, holds its items, changes it and issues it", async () => {
    const fee = await item("Advance 50%", 40_000_000);
    const extra = await item("Extra cut", null);
    const draft = await recordInvoice({ itemIds: [fee, extra], number: null, issuedOn: today, vatRateBp: 1000, amounts: {}, note: null, draft: true }, ids.finance);
    expect(draft).toMatchObject({ status: "draft", number: null, subtotalVnd: 40_000_000, vatVnd: 4_000_000 });
    // The items stay ready for finance, but no other invoice takes them while the draft holds them.
    expect((await billing(fee)).status).toBe("ready");
    expect(await heldBillingItemIds([fee, extra])).toEqual(new Set([fee, extra]));
    expect(await fails(recordInvoice({ itemIds: [fee], number: "0000900", issuedOn: today, vatRateBp: 1000, amounts: {}, note: null }, ids.finance))).toBe("invoice_item_held");
    // A draft is not owed: not in the aging, not open.
    expect(await listInvoices(finance(), { status: "open" })).toEqual([]);
    expect((await listInvoices(finance(), { status: "draft" })).map((row) => [row.id, row.standing, row.outstandingVnd])).toEqual([[draft.id, "draft", 0]]);

    // Issuing a draft needs every amount; the draft keeps the one typed for the item without one.
    expect(await fails(issueInvoice(draft.id, { number: "0000901", issuedOn: today }, ids.finance))).toBe("billing_amount_required");
    const { after: changed } = await saveDraftInvoice(draft.id, { itemIds: [fee, extra], number: null, issuedOn: today, vatRateBp: 800, amounts: { [extra]: 10_000_000 }, note: "Tết" });
    expect(changed).toMatchObject({ status: "draft", subtotalVnd: 50_000_000, vatVnd: 4_000_000, totalVnd: 54_000_000, note: "Tết" });

    const other = await item("Shooting day", 5_000_000);
    const issuedElsewhere = await recordInvoice({ itemIds: [other], number: "0000901", issuedOn: today, vatRateBp: 1000, amounts: {}, note: null }, ids.finance);
    expect(issuedElsewhere.status).toBe("open");
    expect(await fails(issueInvoice(draft.id, { number: "0000901", issuedOn: today }, ids.finance))).toBe("invoice_number_taken");
    const { after: issued } = await issueInvoice(draft.id, { number: "0000902", issuedOn: today }, ids.finance);
    expect(issued).toMatchObject({ status: "open", number: "0000902", subtotalVnd: 50_000_000, totalVnd: 54_000_000 });
    expect(await billing(extra)).toMatchObject({ status: "invoiced", invoiceNumber: "0000902", amountVnd: 10_000_000 });
    // Issued: never changed or deleted again.
    expect(await fails(saveDraftInvoice(draft.id, { itemIds: [fee], number: "0000902", issuedOn: today, vatRateBp: 800, amounts: {}, note: null }))).toBe("invoice_not_draft");
    expect(await fails(deleteDraftInvoice(draft.id))).toBe("invoice_not_draft");
  });

  it("deletes a draft nobody will issue, freeing its items — and only a draft", async () => {
    const spare = await item("Spare", 1_000_000);
    const draft = await recordInvoice({ itemIds: [spare], number: null, issuedOn: today, vatRateBp: 1000, amounts: {}, note: null, draft: true }, ids.finance);
    expect(await fails(voidInvoice(draft.id, "wrong", ids.finance))).toBe("invoice_not_issued");
    await deleteDraftInvoice(draft.id);
    expect(await findInvoice(draft.id)).toBeUndefined();
    expect(await heldBillingItemIds([spare])).toEqual(new Set());
    expect((await billing(spare)).status).toBe("ready");
  });

  it("refuses a payment above what is owed, and reverses one recorded by mistake instead of deleting it", async () => {
    const [invoice] = await listInvoices(finance(), { status: "open" }).then((rows) => rows.filter((row) => row.number === "0000902"));
    const over = await failure(recordPayment(invoice.id, { receivedOn: today, amountVnd: 54_000_001, method: "transfer", reference: null, note: null }, ids.finance));
    expect(over?.message).toBe("payment_above_outstanding");
    expect(over?.details).toEqual({ outstandingVnd: 54_000_000 });
    const { payment, invoice: paid } = await recordPayment(invoice.id, { receivedOn: today, amountVnd: 54_000_000, method: "transfer", reference: "VCB 1", note: null }, ids.finance);
    expect(paid.status).toBe("paid");

    // Paid: it cannot be voided while the payment stands.
    expect(await fails(voidInvoice(invoice.id, "Wrong client", ids.finance))).toBe("invoice_has_payments");
    expect(await fails(reversePayment(payment.id, "  ", ids.finance))).toBe("payment_reason_required");
    const reversed = await reversePayment(payment.id, "Bank returned the transfer", ids.finance);
    expect(reversed.invoice.status).toBe("open");
    expect(reversed.after).toMatchObject({ reversedByPersonId: ids.finance, reversedReason: "Bank returned the transfer", amountVnd: 54_000_000 });
    expect(await fails(reversePayment(payment.id, "again", ids.finance))).toBe("payment_reversed");
    // Still on the invoice, counting for nothing.
    const detail = await getInvoice(finance(), invoice.id);
    expect(detail?.payments.map((row) => [row.id, !!row.reversedAt, row.reversedByName])).toEqual([[payment.id, true, "finance"]]);
    expect(detail?.invoice).toMatchObject({ paidVnd: 0, outstandingVnd: 54_000_000, standing: "open" });
  });

  it("voids an issued invoice with the reason, keeping it and its number, and gives its items back to the queue", async () => {
    const [invoice] = (await listInvoices(finance(), { status: "open" })).filter((row) => row.number === "0000902");
    const lines = await db().select().from(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoice.id));
    // The line keeps what the item was invoiced at.
    expect(lines.map((line) => line.amountVnd).sort()).toEqual([10_000_000, 40_000_000]);
    expect(await fails(voidInvoice(invoice.id, " ", ids.finance))).toBe("invoice_reason_required");
    const { after, released } = await voidInvoice(invoice.id, "Issued to the wrong legal name", ids.finance);
    expect(after).toMatchObject({ status: "void", number: "0000902", voidedReason: "Issued to the wrong legal name", voidedByPersonId: ids.finance });
    expect(released).toBe(2);
    for (const line of lines) expect(await billing(line.billingItemId)).toMatchObject({ status: "ready", invoiceNumber: null, invoiceDate: null });
    expect(await heldBillingItemIds(lines.map((line) => line.billingItemId))).toEqual(new Set());
    expect((await getInvoice(finance(), invoice.id))?.invoice).toMatchObject({ standing: "void", outstandingVnd: 0, voidedByName: "finance" });
    expect(await fails(voidInvoice(invoice.id, "again", ids.finance))).toBe("invoice_closed");

    // The invoice that replaces it takes the same items under a new number; the voided number stays the voided invoice's.
    const itemIds = lines.map((line) => line.billingItemId);
    expect(await fails(recordInvoice({ itemIds, number: "0000902", issuedOn: today, vatRateBp: 800, amounts: {}, note: null }, ids.finance))).toBe("invoice_number_taken");
    const replacement = await recordInvoice({ itemIds, number: "0000903", issuedOn: today, vatRateBp: 800, amounts: {}, note: null }, ids.finance);
    expect(replacement).toMatchObject({ status: "open", subtotalVnd: 50_000_000, totalVnd: 54_000_000 });
    expect(await db().select().from(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.billingItemId, itemIds[0]))).toHaveLength(2);
  });
});

describe("a payment changed after its commission was stated (CRM-05)", () => {
  const cb = () => principalOf(ids.cb);
  const statement = async () => (await listCommissionStatements(cb(), month)).find((row) => row.row.personId === ids.seller)!;
  let invoiceId = "";

  it("takes a confirmed statement back to draft and works it out again when a payment is reversed", async () => {
    const scheme = await proposeCommissionScheme({ entityId: null, name: "2026", validFrom: "2026-01-01", rule: { base: "cash_collected", earner: "deal_owner", splitOwnerBp: 10_000, tiers: [{ fromVnd: 0, rateBp: 1000 }] } }, ids.cb);
    await decideCommissionScheme(scheme.id, "approved", ids.cb);
    const [replacement] = (await listInvoices(finance(), { status: "open" })).filter((row) => row.number === "0000903");
    invoiceId = replacement.id;
    // 54m in two payments: 50m net of VAT, 10% to the deal's owner.
    const first = await recordPayment(invoiceId, { receivedOn: today, amountVnd: 27_000_000, method: "transfer", reference: null, note: null }, ids.finance);
    await recordPayment(invoiceId, { receivedOn: today, amountVnd: 27_000_000, method: "transfer", reference: null, note: null }, ids.finance);
    await computeCommission(month);
    expect((await statement()).amountVnd).toBe(5_000_000);
    await confirmStatement((await statement()).row.id, cb(), ids.cb);
    expect((await statement()).row.status).toBe("confirmed");

    const { commission } = await reversePayment(first.payment.id, "Recorded twice", ids.finance);
    expect(commission).toEqual({ reopened: 1, settled: 0 });
    expect(await statement()).toMatchObject({ amountVnd: 2_500_000, row: { status: "draft", confirmedByPersonId: null } });
    expect(await noticesOf(ids.cb, "crm.commission_reopened")).toHaveLength(1);
  });

  it("takes it back out of a payroll run still open, and leaves one paid in a closed run to be adjusted there", async () => {
    await confirmStatement((await statement()).row.id, cb(), ids.cb);
    const [run] = await db().insert(schema.payrollRun).values({ entityId: ids.szm, month }).returning();
    expect(await postConfirmedCommissions(null)).toMatchObject({ posted: 1 });
    expect(await db().select().from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, run.id))).toHaveLength(1);

    // The other half arrives late, recorded after C&B put the month in payroll.
    const late = await recordPayment(invoiceId, { receivedOn: today, amountVnd: 27_000_000, method: "transfer", reference: null, note: null }, ids.finance);
    expect(late.commission).toEqual({ reopened: 1, settled: 0 });
    expect(await statement()).toMatchObject({ amountVnd: 5_000_000, row: { status: "draft", payrollRunId: null } });
    expect(await db().select().from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, run.id))).toEqual([]);

    // Confirmed and posted again, then the run is approved: the money is on its way.
    await confirmStatement((await statement()).row.id, cb(), ids.cb);
    expect((await statement()).row.status).toBe("in_payroll");
    await db().update(schema.payrollRun).set({ status: "approved" }).where(eq(schema.payrollRun.id, run.id));
    const reversed = await reversePayment(late.payment.id, "Cheque bounced", ids.finance);
    expect(reversed.commission).toEqual({ reopened: 0, settled: 1 });
    expect(await statement()).toMatchObject({ amountVnd: 5_000_000, row: { status: "in_payroll", payrollRunId: run.id } });
    expect(await noticesOf(ids.cb, "crm.commission_after_payroll")).toHaveLength(1);
  });

  it("leaves a month nobody has stated alone", async () => {
    const lastYear = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const extra = await item("Old work", 1_000_000);
    const old = await recordInvoice({ itemIds: [extra], number: "0000950", issuedOn: addDays(today, -400), vatRateBp: 0, amounts: {}, note: null }, ids.finance);
    const { commission } = await recordPayment(old.id, { receivedOn: addDays(today, -400), amountVnd: 1_000_000, method: "cash", reference: null, note: null }, ids.finance);
    expect(commission).toEqual({ reopened: 0, settled: 0 });
    expect(await db().select().from(schema.crmCommissionStatement).where(eq(schema.crmCommissionStatement.month, lastYear))).toEqual([]);
  });
});
