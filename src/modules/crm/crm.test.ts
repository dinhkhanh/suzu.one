// The CRM against a real Postgres (PGlite), end to end: an account with its contacts and follow-ups,
// a referred lead converted to a deal, stage gates, a quote through the approval engine, the win,
// the delivery project prefilled from the quote and handed to its lead, a contract that opens its own
// renewal, and an invoice over billing items paid in two parts — each reminder sent once.
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
// The delivering team's average loaded hour as payroll would answer it. `undefined`: payroll itself
// is asked (there is no signed month in this database, so it has none to give).
const cost = vi.hoisted(() => ({ rate: undefined as number | null | undefined, asked: 0 }));
vi.mock("@/modules/payroll/service", async (original) => {
  const actual = await original<typeof import("@/modules/payroll/service")>();
  const blendedCostRate: typeof actual.blendedCostRate = (...args) => {
    cost.asked += 1;
    return cost.rate === undefined ? actual.blendedCostRate(...args) : Promise.resolve(cost.rate);
  };
  return { ...actual, blendedCostRate };
});

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { createManualBillingItem } from "../projects/billing";
import { readPlan } from "../projects/plans";
import { createTeam, setTeamMember } from "../work/teams";
import { accountSignals, createAccount, findAccount, listAccounts, refreshLifecycles } from "./accounts";
import { listFollowUpsOf, recordActivity, sendFollowUpReminders } from "./activities";
import { eraseContact, listContacts, saveContact } from "./contacts";
import { openRenewals, saveContract, signContract } from "./contracts";
import { convertLead } from "./conversion";
import { createDeal, getDeal, listDealBoard, listDealPage, listDeals, moveDeal, pipelineTotals, setDealContacts } from "./deals";
import { listSalesHandoffsFor, respondToHandoff, setUpDelivery } from "./delivery";
import { agingSummary, listInvoices, recordInvoice, recordPayment, sendReceivableReminders } from "./invoices";
import { createLead, findLead } from "./leads";
import type { AccountTie, CrmViewer } from "./policy";
import { answerQuote, createQuote, decideQuote, findQuote, getQuote, quoteReaderView, reviseQuote, saveQuote, sendQuote, submitQuote } from "./quotes";
import { firstStageOf, listStages } from "./stages";
import { seedStages } from "./seed";
import { accountTimeline } from "./timeline";
import { tiesFrom } from "./viewer";
import { workflow } from "../../../tests/helpers/workflows";

const ids = {} as Record<"szm" | "seller" | "am" | "lead" | "director" | "finance" | "colleague" | "member" | "team" | "account" | "contact", string>;
const today = todayInVietnam();
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: Error & { details?: unknown }) => error);
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const grantsOf: Record<string, Grant[]> = {};
const principalOf = (personId: string): Principal => ({ personId, workforceType: "employee", grants: grantsOf[personId] ?? [] });
const viewerOf = (personId: string, ties: [string, AccountTie[]][] = []): CrmViewer => ({ principal: principalOf(personId), ties: new Map(ties) });

beforeAll(async () => {
  await migrateTestDb();
  // Payroll takes a figure only under a code its catalogue holds as a typed-in component — what
  // `pnpm db:seed` gives every real database. Without it the posting is refused, not skipped.
  await db().insert(schema.payComponent).values({ code: "COMMISSION", name: "Hoa hồng", kind: "earning", category: "commission", source: "input", validFrom: "2026-01-01", status: "approved" });
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["seller", "am", "lead", "director", "finance", "colleague", "member"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values([
    { personId: ids.seller, role: "sales", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
    { personId: ids.director, role: "entity_director", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
    { personId: ids.finance, role: "finance", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
  ]);
  grantsOf[ids.seller] = [{ role: "sales", scope: { type: "entity", id: szm.id } }];
  grantsOf[ids.director] = [{ role: "entity_director", scope: { type: "entity", id: szm.id } }];
  grantsOf[ids.finance] = [{ role: "finance", scope: { type: "entity", id: szm.id } }];
  await db().insert(schema.statutoryParameter).values([
    { key: "crm.settings", validFrom: "2021-01-01", value: { staleDealDays: 14, renewalLeadDays: 45, receivableReminderDays: [1, 15, 30], defaultPaymentTermsDays: 30, quoteValidityDays: 30, quoteDiscountApprovalBp: 1000, quoteMarginFloorBp: 3000 }, status: "approved", isVerified: false, legalReference: "test" },
    { key: "tax.vat", validFrom: "2021-01-01", value: { defaultBp: 1000, allowedBp: [0, 800, 1000] }, status: "approved", isVerified: false, legalReference: "test" },
  ]);
  await seedStages(db() as never);
  const team = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.lead);
  ids.team = team.id;
  await setTeamMember(team.id, ids.member, "member");
});

describe("accounts and contacts", () => {
  it("makes an account with its profile, and stops a likely duplicate until confirmed", async () => {
    const { client, profile } = await createAccount({ code: "VNM", name: "Vinamilk", entityId: ids.szm, note: null, profile: { legalName: "Công ty CP Sữa Việt Nam", taxCode: "0300588569", address: null, website: null, industry: "FMCG", size: "enterprise", source: "referral", tier: "a", contractingEntityId: ids.szm }, salesOwnerPersonId: ids.seller, accountManagerPersonId: ids.am, confirmDuplicate: false });
    ids.account = client.id;
    expect(profile).toMatchObject({ taxCode: "0300588569", lifecycle: "prospect", salesOwnerPersonId: ids.seller });
    expect((await findAccount(client.id))?.client.accountManagerPersonId).toBe(ids.am);
    const duplicate = await failure(createAccount({ code: "VNM2", name: "Sữa Việt Nam", entityId: ids.szm, note: null, profile: { legalName: null, taxCode: "0300 588 569", address: null, website: null, industry: null, size: null, source: null, tier: null, contractingEntityId: null }, salesOwnerPersonId: null, accountManagerPersonId: null, confirmDuplicate: false }));
    expect(duplicate?.message).toBe("account_duplicate");
    expect(duplicate?.details).toEqual({ duplicates: [{ clientId: client.id, name: "Vinamilk", reason: "tax_code" }] });
    expect(await fails(createAccount({ code: "BAD", name: "Bad", entityId: null, note: null, profile: { legalName: null, taxCode: "12345", address: null, website: null, industry: null, size: null, source: null, tier: null, contractingEntityId: null }, salesOwnerPersonId: null, accountManagerPersonId: null, confirmDuplicate: true }))).toBe("tax_code_invalid");
  });

  it("keeps contacts' details from readers outside the team, and erases them on request keeping the name", async () => {
    const input = { fullName: "Nguyễn Thị Lan", title: "Brand manager", email: "Lan@Vinamilk.vn", phone: "0901234567", zalo: null, decisionRole: "decision_maker" as const, isPrimary: true, preferredChannel: "email", birthday: null, notes: "Prefers mornings", source: "business_card", lawfulBasis: "legitimate_interest", status: "active" as const, brandIds: [] };
    const { after } = await saveContact(ids.account, null, input, ids.seller);
    ids.contact = after.id;
    expect(after.email).toBe("lan@vinamilk.vn");
    expect(await fails(saveContact(ids.account, null, { ...input, fullName: "Lan N." }, ids.seller))).toBe("contact_duplicate");
    const outside = await listContacts(ids.account, false);
    expect(outside[0]).toMatchObject({ fullName: "Nguyễn Thị Lan", title: "Brand manager", details: null });
    const inside = await listContacts(ids.account, true);
    expect(inside[0].details?.email).toBe("lan@vinamilk.vn");

    const { after: other } = await saveContact(ids.account, null, { ...input, fullName: "Trần Minh", email: "minh@vinamilk.vn", phone: null, isPrimary: false }, ids.seller);
    const { after: erased } = await eraseContact(other.id);
    expect(erased).toMatchObject({ fullName: "Trần Minh", email: null, phone: null, notes: null, status: "left" });
    expect(erased.erasedAt).not.toBeNull();
    expect(await fails(eraseContact(other.id))).toBe("contact_erased");

    // What a PJM form offers for "decided by" / "signed by" (FR-CRM-46): names and titles of the active contacts only.
    const { contactChoicesFor } = await import("./contacts");
    expect(await contactChoicesFor(ids.account)).toEqual([{ name: "Nguyễn Thị Lan", title: "Brand manager" }]);
    expect(await contactChoicesFor(null)).toEqual([]);
  });

  it("puts a follow-up on its owner's day, tells them, and reminds once on the morning it is due", async () => {
    const { logged, followUp } = await recordActivity({ kind: "call", subject: "Intro call", body: null, clientId: ids.account, contactId: ids.contact, dealId: null, leadId: null, occurredAt: new Date(), outcome: "Wants a Tết proposal", followUp: { ownerPersonId: ids.am, dueOn: today, subject: "Send the Tết proposal" } }, ids.seller);
    expect(logged?.doneAt).not.toBeNull();
    expect(followUp).toMatchObject({ subject: "Send the Tết proposal", ownerPersonId: ids.am, dueOn: today, doneAt: null, kind: "task" });
    expect(await noticesOf(ids.am, "crm.followup_assigned")).toHaveLength(1);
    expect((await listFollowUpsOf(ids.am, today)).map((row) => row.id)).toContain(followUp!.id);
    expect(await sendFollowUpReminders(today)).toEqual({ followUpsReminded: 1 });
    expect(await sendFollowUpReminders(today)).toEqual({ followUpsReminded: 0 });
    expect(await noticesOf(ids.am, "crm.followup_due")).toHaveLength(1);
  });
});

describe("leads and the pipeline", () => {
  let dealId = "";

  it("takes a colleague's referral to the sales directors and credits the referrer when it converts", async () => {
    const lead = await createLead({ entityId: ids.szm, clientId: null, companyName: "Vinamilk", contactName: "Lan", contactTitle: null, email: null, phone: null, need: "Tết campaign", budgetText: "~200tr", source: "referral" }, { personId: ids.colleague, sells: false }, null);
    expect(lead).toMatchObject({ referrerPersonId: ids.colleague, ownerPersonId: null });
    expect(await noticesOf(ids.director, "crm.lead_assigned")).toHaveLength(1);
    const { deal } = await convertLead(lead.id, { account: { clientId: ids.account }, contact: { contactId: ids.contact }, deal: { title: "Tết 2027 campaign", brandId: null, serviceLines: ["video", "social"], oneOffVnd: null, monthlyVnd: null, months: null, probability: null, expectedCloseOn: null, teamId: ids.team, entityId: ids.szm, source: null, competitors: null, nextStep: "Kick-off in January", stageId: null, ownerPersonId: ids.seller } }, ids.seller);
    dealId = deal.id;
    expect(deal.code).toMatch(/^DL-SZM-\d{2}-001$/);
    expect(deal).toMatchObject({ status: "open", source: "referral", ownerPersonId: ids.seller, clientId: ids.account });
    expect((await findLead(lead.id))?.status).toBe("converted");
    expect(await noticesOf(ids.colleague, "crm.lead_converted")).toHaveLength(1);
    expect(await fails(convertLead(lead.id, { account: { clientId: ids.account }, contact: null, deal: { title: "again", brandId: null, serviceLines: [], oneOffVnd: null, monthlyVnd: null, months: null, probability: null, expectedCloseOn: null, teamId: null, entityId: ids.szm, source: null, competitors: null, nextStep: null, stageId: null, ownerPersonId: ids.seller } }, ids.seller))).toBe("lead_closed");
  });

  it("refuses a stage whose gates the deal does not meet, and names them", async () => {
    const stages = await listStages();
    const proposal = stages.find((stage) => stage.nameEn === "Proposal / pitch")!;
    await setDealContacts(dealId, []);
    const refused = await failure(moveDeal(dealId, proposal.id, ids.seller));
    expect(refused?.message).toBe("deal_gates");
    expect(refused?.details).toEqual({ gates: ["contacts", "close_date"] });
    await setDealContacts(dealId, [{ contactId: ids.contact, role: "decides" }]);
    await db().update(schema.crmDeal).set({ expectedCloseOn: addDays(today, 20) }).where(eq(schema.crmDeal.id, dealId));
    expect((await moveDeal(dealId, proposal.id, ids.seller)).after.stageId).toBe(proposal.id);
  });

  it("sends a quote with a large discount to the sales director, and gives the deal its value when the client accepts", async () => {
    const quote = await createQuote(dealId, ids.seller);
    expect(quote).toMatchObject({ number: expect.stringMatching(/^BG-SZM-\d{2}-001$/), version: 1, vatRateBp: 1000, status: "draft" });
    await saveQuote(quote.id, {
      title: "Tết 2027",
      validUntil: addDays(today, 30),
      vatRateBp: 1000,
      intro: null,
      terms: null,
      lines: [
        { serviceId: null, title: "TVC 30s", description: null, quantity: 1, unit: "video", unitPriceVnd: 120_000_000, discountBp: 1500, months: null, format: "tvc", channel: "youtube", roleMinutes: [{ role: "Video editing", minutes: 1920 }] },
        { serviceId: null, title: "Page management", description: null, quantity: 1, unit: "month", unitPriceVnd: 25_000_000, discountBp: 0, months: 3, format: null, channel: "facebook", roleMinutes: [{ role: "Account", minutes: 1800 }] },
      ],
    });
    const submitted = await submitQuote(quote.id, ids.seller);
    expect(submitted.reasons).toEqual(["discount"]);
    expect(submitted.quote.status).toBe("in_approval");
    const decided = await decideQuote(ids.director, submitted.requestId!, { action: "approve", comment: "ok for Tết" });
    expect(decided.after.status).toBe("approved");
    await sendQuote(quote.id, ids.seller);
    await answerQuote(quote.id, true, "Signed off by Lan");
    const deal = await getDeal(viewerOf(ids.seller, [[ids.account, ["deal_owner"]]]), dealId);
    expect(deal?.deal.value).toMatchObject({ oneOffVnd: 102_000_000, monthlyVnd: 25_000_000, months: 3, totalVnd: 177_000_000 });
    const revised = await reviseQuote(quote.id, ids.seller);
    expect(revised).toMatchObject({ number: quote.number, version: 2, status: "draft", totalVnd: (await findQuote(quote.id))!.totalVnd });
  });

  it("sets the accepted quote's hours against the team's free time, for whoever may plan the team (FR-CRM-17)", async () => {
    const { staffingCheck } = await import("./staffing");
    const { listQuotes } = await import("./quotes");
    const [deal] = await db().select().from(schema.crmDeal).where(eq(schema.crmDeal.id, dealId));
    const quotes = await listQuotes(dealId);
    const [seller] = await db().select().from(schema.person).where(eq(schema.person.id, ids.seller));
    // A seller plans nobody's time: no check, rather than somebody's leave.
    expect(await staffingCheck({ person: seller, principal: principalOf(ids.seller) } as never, deal, quotes, today)).toBeNull();
    const [director] = await db().select().from(schema.person).where(eq(schema.person.id, ids.director));
    const check = await staffingCheck({ person: director, principal: { personId: ids.director, workforceType: "employee", grants: [{ role: "c_level", scope: { type: "group" } }] } } as never, deal, quotes, today);
    expect(check).toMatchObject({ needByRole: [{ role: "Account" }, { role: "Video editing" }], from: deal.expectedCloseOn });
    expect(check!.shortMinutes).toBe(Math.max(0, check!.needMinutes - check!.freeMinutes));
  });

  it("wins the deal and tells the team that will deliver it", async () => {
    const won = firstStageOf(await listStages(), "won")!;
    const { after } = await moveDeal(dealId, won.id, ids.seller);
    expect(after.status).toBe("won");
    expect(after.wonAt).not.toBeNull();
    expect(await noticesOf(ids.lead, "crm.deal_won")).toHaveLength(1);
    expect(await fails(moveDeal(dealId, won.id, ids.seller))).toBe("deal_closed");
  });

  it("makes the delivery project from the accepted quote and hands it to its lead", async () => {
    const { project } = await setUpDelivery(dealId, { teamId: ids.team, leadPersonId: ids.lead, name: "Vinamilk — Tết 2027", templateId: null, startDate: "2026-11-02", dueDate: null, visibility: "team", contractId: null, note: { context: "Won against two agencies", questions: "Which KOLs?" } }, ids.seller);
    expect(project).toMatchObject({ status: "planned", clientId: ids.account, leadPersonId: ids.lead });
    const plan = await readPlan(project.id);
    expect(plan).toMatchObject({ kind: "retainer", feeVnd: 102_000_000, accountManagerPersonId: ids.am, budgetByRole: [{ role: "Video editing", minutes: 1920 }], budgetMinutes: 1920 });
    expect(plan?.brief.objective).toBe("Tết 2027 campaign — Kick-off in January");
    // A name and a role, and nothing to reach her by: the brief is read by everyone on the project (CRM-02).
    expect(plan?.brief.clientContacts).toEqual([{ name: "Nguyễn Thị Lan", role: "decides" }]);
    const [handoff] = await db().select().from(schema.crmDealProject).where(eq(schema.crmDealProject.projectId, project.id));
    expect(handoff.handoffNote.contacts).toBe("Nguyễn Thị Lan — decides");
    for (const detail of ["vinamilk.vn", "0901234567"]) expect(JSON.stringify([plan?.brief, handoff.handoffNote])).not.toContain(detail);
    const register = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, project.id));
    expect(register.map((line) => [line.title, line.quantity, line.format])).toEqual([["TVC 30s", 1, "tvc"]]);
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, project.id));
    expect(retainer).toMatchObject({ startMonth: "2026-11", endMonth: "2027-01", feePerMonthVnd: 25_000_000, minutesPerMonth: 600, lines: [{ title: "Page management", quantity: 1, format: null, channel: "facebook" }] });
    const members = await db().select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, project.id));
    expect(new Map(members.map((row) => [row.personId, row.role]))).toEqual(new Map([[ids.seller, "member"], [ids.lead, "lead"], [ids.am, "account_manager"]]));
    expect(await noticesOf(ids.lead, "crm.delivery_handoff")).toHaveLength(1);
    expect((await listSalesHandoffsFor(ids.lead)).map((row) => row.projectId)).toEqual([project.id]);
    expect(await fails(respondToHandoff(project.id, { accept: true }, ids.seller))).toBe("handoff_not_yours");
    expect((await respondToHandoff(project.id, { accept: true }, ids.lead)).after.handoffStatus).toBe("accepted");
    expect(await listSalesHandoffsFor(ids.lead)).toEqual([]);
    expect(await noticesOf(ids.seller, "crm.delivery_handoff_answered")).toHaveLength(1);
  });

  it("shows the deal to the delivery lead without its value, and to nobody outside", async () => {
    const [clients, directory] = await Promise.all([db().select().from(schema.workClient), db().select().from(schema.workProject)]);
    const members = await db().select().from(schema.workProjectMember).where(eq(schema.workProjectMember.personId, ids.lead));
    const ties = tiesFrom({ personId: ids.lead, clients, own: { salesOwner: [], member: [], dealOwner: [] }, projectIds: members.map((row) => row.projectId), projects: directory });
    const lead = { principal: principalOf(ids.lead), ties };
    const seen = await listDeals(lead, { status: "all" });
    expect(seen.map((deal) => deal.id)).toEqual([dealId]);
    expect(seen[0].value).toBeUndefined();
    expect(await listDeals(viewerOf(ids.colleague), { status: "all" })).toEqual([]);
    expect((await listDeals(viewerOf(ids.finance), { status: "all" }))).toEqual([]);
  });

  it("proposes the account active once it has an open project", async () => {
    expect(await refreshLifecycles(today)).toEqual({ lifecyclesChanged: 1 });
    expect(await refreshLifecycles(today)).toEqual({ lifecyclesChanged: 0 });
    const [row] = await listAccounts(viewerOf(ids.seller, [[ids.account, ["sales_owner"]]]), { q: "vinamilk" });
    expect(row.profile?.lifecycle).toBe("active");
    expect(row.signals.openProjects).toBe(1);
  });
});

describe("contracts, invoices and payments", () => {
  it("opens one renewal deal for a contract ending within the lead time", async () => {
    const { after: contract } = await saveContract(ids.account, null, { number: "15/2026/HĐDV-SZM", title: "Social retainer 2026", kind: "service", entityId: ids.szm, parentContractId: null, dealId: null, startDate: "2026-01-01", endDate: addDays(today, 30), valueVnd: 300_000_000, paymentTermsDays: 15, autoRenew: false, noticeDays: 30, note: null }, ids.am);
    const [file] = await db().insert(schema.storedFile).values({ bucket: "test", objectPath: `crm_contract/${contract.id}.pdf`, fileName: "hd.pdf", contentType: "application/pdf", sizeBytes: 100, ownerType: "crm_contract", ownerId: contract.id, entityId: ids.szm, tier: "personal", status: "ready", uploadedByPersonId: ids.am }).returning();
    await signContract(contract.id, { signedOn: "2026-01-01", signedFileId: file.id });
    expect(await openRenewals(today)).toEqual({ renewalsOpened: 1 });
    expect(await openRenewals(today)).toEqual({ renewalsOpened: 0 });
    const [renewal] = await db().select().from(schema.crmDeal).where(eq(schema.crmDeal.renewsContractId, contract.id));
    expect(renewal).toMatchObject({ ownerPersonId: ids.am, status: "open", expectedCloseOn: addDays(today, 30) });
    expect(await noticesOf(ids.am, "crm.renewal_opened")).toHaveLength(1);
    expect(await fails(saveContract(ids.account, null, { number: "15/2026/HĐDV-SZM", title: "Dup", kind: "service", entityId: ids.szm, parentContractId: null, dealId: null, startDate: null, endDate: null, paymentTermsDays: null, autoRenew: false, noticeDays: null, note: null }, ids.am))).toBe("contract_number_taken");
  });

  it("records an invoice over billing items, ages it, reminds once, and closes it when paid", async () => {
    const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.clientId, ids.account));
    const item = await createManualBillingItem(project.id, { description: "Advance 50%", reference: null, amountVnd: 51_000_000 }, ids.finance);
    const invoice = await recordInvoice({ itemIds: [item.id], number: "0000123", issuedOn: addDays(today, -40), vatRateBp: 1000, amounts: {}, note: null }, ids.finance);
    expect(invoice).toMatchObject({ subtotalVnd: 51_000_000, vatVnd: 5_100_000, totalVnd: 56_100_000, dueOn: addDays(today, -10), status: "open" });
    const [billed] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, item.id));
    expect(billed).toMatchObject({ status: "invoiced", invoiceNumber: "0000123" });
    expect(await fails(recordInvoice({ itemIds: [item.id], number: "0000124", issuedOn: today, vatRateBp: 1000, amounts: {}, note: null }, ids.finance))).toBe("billing_decided");

    const finance = viewerOf(ids.finance);
    expect(await agingSummary(finance)).toMatchObject({ d1_30: 56_100_000, total: 56_100_000, invoices: 1 });
    expect(await agingSummary(viewerOf(ids.seller))).toMatchObject({ total: 0, invoices: 0 });
    expect(await agingSummary(viewerOf(ids.am, [[ids.account, ["manager"]]]))).toMatchObject({ total: 56_100_000 });

    expect(await sendReceivableReminders(today)).toEqual({ invoicesReminded: 1 });
    expect(await sendReceivableReminders(today)).toEqual({ invoicesReminded: 0 });
    expect(await noticesOf(ids.am, "crm.invoice_overdue")).toHaveLength(1);

    await recordPayment(invoice.id, { receivedOn: today, amountVnd: 20_000_000, method: "transfer", reference: "VCB 123", note: null }, ids.finance);
    const [partial] = await listInvoices(finance, { status: "open" });
    expect(partial).toMatchObject({ paidVnd: 20_000_000, outstandingVnd: 36_100_000, standing: "part_paid" });
    const { invoice: paid } = await recordPayment(invoice.id, { receivedOn: today, amountVnd: 36_100_000, method: "transfer", reference: "VCB 124", note: null }, ids.finance);
    expect(paid.status).toBe("paid");
    expect(await fails(recordPayment(invoice.id, { receivedOn: today, amountVnd: 1, method: "cash", reference: null, note: null }, ids.finance))).toBe("invoice_closed");
    expect((await accountSignals([ids.account], today)).get(ids.account)).toMatchObject({ receivableVnd: 0, overdueVnd: 0 });
  });

  it("reads the account's history from every module on one timeline", async () => {
    const account = (await findAccount(ids.account))!;
    const projects = await db().select({ id: schema.workProject.id }).from(schema.workProject).where(eq(schema.workProject.clientId, ids.account));
    const kinds = new Set((await accountTimeline({ clientIds: [ids.account], accountId: account.client.id, projectIds: projects.map((row) => row.id), worksAccount: true, seesReceivables: true })).map((item) => item.kind));
    for (const kind of ["activity", "deal_opened", "deal_won", "quote_sent", "contract_signed", "project_opened", "invoice", "payment"] as const) expect(kinds.has(kind)).toBe(true);
    const outsider = await accountTimeline({ clientIds: [ids.account], accountId: account.client.id, projectIds: [], worksAccount: false, seesReceivables: false });
    expect(outsider).toEqual([]);
  });

  it("opens a deal only on an account's client, filing a brand under it", async () => {
    const [brand] = await db().insert(schema.workClient).values({ code: "VNM-PROBI", name: "Probi", kind: "brand", parentId: ids.account, entityId: ids.szm }).returning();
    const deal = await createDeal({ clientId: brand.id, title: "Probi launch", brandId: null, serviceLines: [], oneOffVnd: 50_000_000, monthlyVnd: null, months: null, probability: null, expectedCloseOn: null, teamId: null, entityId: ids.szm, source: null, competitors: null, nextStep: null, ownerPersonId: ids.seller, stageId: null, leadId: null, contacts: [] }, ids.seller);
    expect(deal).toMatchObject({ clientId: ids.account, brandId: brand.id });
  });
});

describe("a leaver's CRM work (FR-CRM-40)", () => {
  it("is listed in the work handover, gated by crm:manage, and handed on with its follow-ups", async () => {
    const { listOwnership, reassignOwnership } = await import("../work/exit");
    const { ownershipSummary } = await import("../work/engine/exit");
    const owned = await listOwnership(ids.seller, db(), { timeWeeks: false });
    const kinds = new Set(owned.map((item) => item.kind));
    expect(kinds.has("crm_sales_owner")).toBe(true);
    expect(kinds.has("crm_deal")).toBe(true);
    expect(ownershipSummary(owned).blocking).toEqual(expect.arrayContaining(["crm_sales_owner", "crm_deal"]));

    const [handover] = await db().insert(schema.workExitHandover).values({ personId: ids.seller, lifecycleEventId: crypto.randomUUID(), reason: "termination", lastDay: today }).returning();
    const crmItems = owned.filter((item) => item.kind.startsWith("crm_"));
    const runner = { principal: principalOf(ids.director), entityId: ids.szm, teamRoles: new Map(), projectRoles: new Map() };
    // Someone who is not a seller cannot receive a deal.
    const refused = await failure(reassignOwnership(handover.id, { items: crmItems, toPersonId: ids.colleague, note: { context: "Leaving" } }, { personId: ids.director, fullName: "director" }, runner));
    expect(refused?.message).toBe("person_not_assignable");
    // A peer without crm:manage may not hand them on at all.
    const outsider = { principal: principalOf(ids.colleague), entityId: ids.szm, teamRoles: new Map(), projectRoles: new Map() };
    expect((await failure(reassignOwnership(handover.id, { items: crmItems, toPersonId: ids.director, note: { context: "Leaving" } }, { personId: ids.colleague, fullName: "colleague" }, outsider)))?.message).toBe("exit_item_not_yours");

    const result = await reassignOwnership(handover.id, { items: crmItems, toPersonId: ids.director, note: { context: "Leaving", next: "Call Lan" } }, { personId: ids.director, fullName: "director" }, runner);
    expect(result.moved.length).toBe(crmItems.length);
    expect((await listOwnership(ids.seller, db(), { timeWeeks: false })).filter((item) => item.kind.startsWith("crm_"))).toEqual([]);
    const deals = await db().select().from(schema.crmDeal).where(and(eq(schema.crmDeal.status, "open"), eq(schema.crmDeal.clientId, ids.account)));
    expect(deals.every((deal) => deal.ownerPersonId !== ids.seller)).toBe(true);
    const handoffs = await db().select().from(schema.workHandoff).where(and(eq(schema.workHandoff.kind, "exit"), eq(schema.workHandoff.fromPersonId, ids.seller)));
    expect(handoffs.length).toBe(crmItems.length);
  });
});

describe("the day's report (FR-CRM-43)", () => {
  it("prefills the calls logged and the deals moved today", async () => {
    const { buildDraft } = await import("../daily/reports");
    const draft = await buildDraft(ids.seller, today);
    const kinds = draft.activity.map((item) => item.kind);
    expect(kinds).toContain("client_activity");
    expect(kinds).toContain("deal_moved");
    expect(draft.activity.find((item) => item.kind === "client_activity")?.title).toBe("Vinamilk: Intro call");
  });
});

describe("leave cover of follow-ups (FR-CRM-41)", () => {
  it("moves the absent person's follow-ups to the cover while the plan runs, and back after", async () => {
    const { applyLeaveCover } = await import("./cover");
    const open = await db().select().from(schema.crmActivity).where(and(eq(schema.crmActivity.ownerPersonId, ids.am), eq(schema.crmActivity.dueOn, today)));
    expect(open.filter((row) => !row.doneAt).length).toBeGreaterThan(0);
    const [plan] = await db().insert(schema.workCoverPlan).values({ personId: ids.am, leaveRequestId: crypto.randomUUID(), fromDate: today, toDate: addDays(today, 2), status: "submitted", defaultCoverPersonId: ids.member, appliedAt: new Date() }).returning();
    const first = await applyLeaveCover(today);
    expect(first.followUpsCovered).toBeGreaterThan(0);
    expect(await applyLeaveCover(today)).toEqual({ followUpsCovered: 0, followUpsHandedBack: 0 });
    const covered = await db().select().from(schema.crmActivity).where(eq(schema.crmActivity.coverFromPersonId, ids.am));
    expect(covered.every((row) => row.ownerPersonId === ids.member)).toBe(true);
    expect(await noticesOf(ids.member, "crm.cover_followups")).toHaveLength(1);
    await db().update(schema.workCoverPlan).set({ status: "handed_back" }).where(eq(schema.workCoverPlan.id, plan.id));
    expect((await applyLeaveCover(today)).followUpsHandedBack).toBe(first.followUpsCovered);
    const back = await db().select().from(schema.crmActivity).where(eq(schema.crmActivity.id, covered[0].id));
    expect(back[0]).toMatchObject({ ownerPersonId: ids.am, coverFromPersonId: null });
  });
});

describe("sales figures for KPI actuals (FR-CRM-44)", () => {
  it("sums the period's wins, invoices, cash and follow-ups per person", async () => {
    const { salesFactsOf } = await import("./sales-facts");
    const facts = await salesFactsOf([ids.seller, ids.am], { from: addDays(today, -60), to: today });
    expect(facts.get(ids.seller)).toMatchObject({ dealsWon: 1, wonValueVnd: 177_000_000, newAccounts: 1, dealsLost: 0 });
    expect(facts.get(ids.am)).toMatchObject({ invoicedVnd: 51_000_000, collectedVnd: 56_100_000 });
    expect(facts.get(ids.am)!.followUpsDue).toBeGreaterThan(0);
  });

  it("gives the owner dashboard this month's wins, the weighted pipeline and the cash, over what the reader may value (FR-CRM-51)", async () => {
    const { salesTile } = await import("./pipeline");
    const seller = await salesTile(viewerOf(ids.seller), today);
    expect(seller).toMatchObject({ wonCount: 1, wonVnd: 177_000_000, overdueVnd: null, collectedVnd: null });
    expect(await salesTile(viewerOf(ids.finance), today)).toMatchObject({ wonCount: 1, wonVnd: 177_000_000, overdueVnd: 0, collectedVnd: 56_100_000 });
    const { revenueOutlook, salesDashboard } = await import("./pipeline");
    const dashboard = await salesDashboard(viewerOf(ids.finance), {}, today);
    expect(dashboard?.byMonth.find((row) => row.month === today.slice(0, 7))).toMatchObject({ wonCount: 1, wonValue: 177_000_000 });
    const outlook = await revenueOutlook(viewerOf(ids.finance), today);
    expect(outlook).toHaveLength(6);
    expect(outlook?.[0].month).toBe(today.slice(0, 7));
  });

  it("builds the weekly pipeline and the receivables aging for their readers only (FR-CRM-52)", async () => {
    const { buildReportFor } = await import("../reports/catalogue");
    const userOf = async (personId: string) => {
      const [person] = await db().select().from(schema.person).where(eq(schema.person.id, personId));
      return { person, principal: principalOf(personId) } as Parameters<typeof buildReportFor>[0];
    };
    const period = { from: addDays(today, -6), to: today };
    const pipeline = await buildReportFor(await userOf(ids.seller), "crm_pipeline", {}, period, "en");
    expect(pipeline?.rows.some((row) => row[0] === "Won" && row[3] === 177_000_000)).toBe(true);
    expect(await buildReportFor(await userOf(ids.seller), "crm_receivables", {}, period, "en")).toBeNull();
    const receivables = await buildReportFor(await userOf(ids.finance), "crm_receivables", {}, period, "en");
    expect(receivables?.rows).toHaveLength(5);
    expect(receivables?.summary).toContain("0 invoices");
  });
});

describe("sales commission (FR-CRM-45)", () => {
  it("works nothing out without an approved scheme, then states the month's cash, shows each statement only to its reader, and puts the confirmed one in payroll", async () => {
    const { computeCommission, confirmStatement, decideCommissionScheme, listCommissionStatements, postConfirmedCommissions, proposeCommissionScheme } = await import("./commission");
    const month = today.slice(0, 7);
    const cb: Principal = { personId: ids.colleague, workforceType: "employee", grants: [{ role: "payroll", scope: { type: "entity", id: ids.szm } }] };

    // No approved scheme: nothing (SRS Q29).
    expect(await computeCommission(month)).toMatchObject({ schemes: 0, written: 0 });
    const scheme = await proposeCommissionScheme({ entityId: null, name: "2026", validFrom: "2026-01-01", rule: { base: "cash_collected", earner: "split", splitOwnerBp: 7000, tiers: [{ fromVnd: 0, rateBp: 300 }] } }, ids.director);
    expect(await computeCommission(month)).toMatchObject({ schemes: 0 });
    await decideCommissionScheme(scheme.id, "approved", ids.director);
    expect(await fails(decideCommissionScheme(scheme.id, "rejected", ids.director))).toBe("commission_scheme_decided");

    // 56.1m collected this month on one invoice: 51m net of VAT, 70% the deal owner's and 30% the account manager's, at 3%.
    expect(await computeCommission(month)).toMatchObject({ schemes: 1, written: 2 });
    const [own] = await listCommissionStatements(principalOf(ids.seller), month, { withTrace: true });
    expect(own).toMatchObject({ amountVnd: 1_071_000, canConfirm: false });
    // Two payments on the invoice (20m and 36.1m): a line each, net of VAT.
    expect(own.trace).toMatchObject({ baseVnd: 35_700_000, lines: expect.arrayContaining([expect.objectContaining({ invoiceNumber: "0000123", as: "deal_owner", netVnd: 18_181_818 }), expect.objectContaining({ netVnd: 32_818_182 })]) });
    expect((await listCommissionStatements(principalOf(ids.seller), month)).map((row) => row.row.personId)).toEqual([ids.seller]);
    // The sales director runs sales, not pay: they read nobody's commission.
    expect(await listCommissionStatements(principalOf(ids.director), month)).toEqual([]);
    const all = await listCommissionStatements(cb, month);
    expect(all.map((row) => row.amountVnd).sort()).toEqual([1_071_000, 459_000].sort());

    // Stored sealed, like payroll's figures.
    const [stored] = await db().select().from(schema.crmCommissionStatement).where(eq(schema.crmCommissionStatement.id, own.row.id));
    expect(stored.amountEnc).not.toContain("1071000");

    // Confirmed with no open run: it waits; the nightly sweep puts it in the run once there is one.
    expect(await fails(confirmStatement(own.row.id, principalOf(ids.seller), ids.seller))).toBe("forbidden");
    const confirmed = await confirmStatement(own.row.id, cb, ids.colleague);
    expect(confirmed).toMatchObject({ posted: false, after: { status: "confirmed" } });
    expect(await noticesOf(ids.seller, "crm.commission_ready")).toHaveLength(1);
    // Working the month out again keeps what C&B confirmed.
    expect(await computeCommission(month)).toMatchObject({ written: 1, kept: 1 });
    const [run] = await db().insert(schema.payrollRun).values({ entityId: ids.szm, month }).returning();
    expect(await postConfirmedCommissions(null)).toEqual({ posted: 1, released: 0 });
    const [input] = await db().select().from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, run.id));
    expect(input).toMatchObject({ personId: ids.seller, code: "COMMISSION" });
    expect(await postConfirmedCommissions(null)).toEqual({ posted: 0, released: 0 });
  });
});

describe("a quote's approval signal (CRM-03)", () => {
  let dealId = "";
  // One line of 10m with no discount unless given; the hours decide the margin.
  const draftOf = async (hours: number, discountBp = 0) => {
    const quote = await createQuote(dealId, ids.seller);
    await saveQuote(quote.id, { title: "Clip", validUntil: null, vatRateBp: 1000, intro: null, terms: null, lines: [{ serviceId: null, title: "Clip", description: null, quantity: 1, unit: "video", unitPriceVnd: 10_000_000, discountBp, months: null, format: null, channel: null, roleMinutes: [{ role: "Video editing", minutes: hours * 60 }] }] });
    return (await getQuote(quote.id))!;
  };
  const seller = { seesMargin: false, drafts: true };

  it("tells a drafter without pjm:cost nothing the margin decides, and does not work the margin out for them", async () => {
    const deal = await createDeal({ clientId: ids.account, title: "Clip series", brandId: null, serviceLines: ["video"], oneOffVnd: null, monthlyVnd: null, months: null, probability: null, expectedCloseOn: null, teamId: ids.team, entityId: ids.szm, source: null, competitors: null, nextStep: null, ownerPersonId: ids.seller, stageId: null, leadId: null, contacts: [] }, ids.seller);
    dealId = deal.id;
    cost.rate = 300_000;
    const healthy = await draftOf(10); // 3m of cost on 10m: 70%
    const thin = await draftOf(30); // 9m of cost on 10m: 10%, under the 30% floor
    cost.asked = 0;
    // Either side of the floor the page is given the same thing, and payroll is never asked.
    expect(await quoteReaderView(healthy.quote, healthy.lines, seller, today)).toEqual({ margin: null, approval: { reasons: [], next: "send" } });
    expect(await quoteReaderView(thin.quote, thin.lines, seller, today)).toEqual({ margin: null, approval: { reasons: [], next: "send" } });
    expect(cost.asked).toBe(0);
    // The discount is their own figure, and says so while drafting.
    const discounted = await draftOf(30, 1500);
    expect(await quoteReaderView(discounted.quote, discounted.lines, seller, today)).toEqual({ margin: null, approval: { reasons: ["discount"], next: "submit" } });
    // A reader of margins keeps the live indicator.
    expect(await quoteReaderView(thin.quote, thin.lines, { seesMargin: true, drafts: true }, today)).toMatchObject({ margin: { costVnd: 9_000_000, marginBp: 1000 }, approval: { reasons: ["margin"], next: "submit" } });
    expect(await quoteReaderView(thin.quote, thin.lines, { seesMargin: true, drafts: false }, today)).toMatchObject({ margin: { marginBp: 1000 }, approval: null });

    // The margin is judged when the quote is sent: under the floor it goes to the sales director instead of out.
    const routed = await sendQuote(thin.quote.id, ids.seller, today);
    expect(routed.after.status).toBe("in_approval");
    expect(routed.check).toEqual({ reasons: ["margin"], marginChecked: true });
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, routed.after.approvalRequestId!));
    expect(request.payload).toMatchObject({ reasons: ["margin"], marginChecked: true });
    expect(await sendQuote(healthy.quote.id, ids.seller, today)).toMatchObject({ after: { status: "sent" }, check: { reasons: [], marginChecked: true } });
  });

  it("lets a quote out on its discount alone when the margin cannot be estimated — and says it was not checked", async () => {
    cost.rate = null;
    const unchecked = await draftOf(30);
    expect(await sendQuote(unchecked.quote.id, ids.seller, today)).toMatchObject({ after: { status: "sent" }, check: { reasons: [], marginChecked: false } });
    const discounted = await draftOf(30, 1500);
    const submitted = await submitQuote(discounted.quote.id, ids.seller, today);
    expect(submitted).toMatchObject({ reasons: ["discount"], marginChecked: false, quote: { status: "in_approval" } });
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, submitted.requestId!));
    expect(request.payload).toMatchObject({ reasons: ["discount"], marginChecked: false });
    cost.rate = undefined;
  });
});

describe("what an activity is recorded against (CRM-01)", () => {
  const activity = (targets: { clientId: string | null; leadId: string | null; dealId?: string | null }) =>
    recordActivity({ kind: "call", subject: "Called", body: null, contactId: null, dealId: null, occurredAt: new Date(), outcome: null, followUp: { ownerPersonId: ids.member, dueOn: today }, ...targets }, ids.colleague);

  it("refuses a lead beside an account that is not its own, and takes it alone or with the account it came from", async () => {
    const stranger = await createLead({ entityId: ids.szm, clientId: null, companyName: "Masan", contactName: "Hùng", contactTitle: null, email: null, phone: null, need: null, budgetText: null, source: "referral" }, { personId: ids.colleague, sells: true }, null);
    // The lead's owner names somebody else's account in the same request: nothing is written on it.
    expect(await fails(activity({ leadId: stranger.id, clientId: ids.account }))).toBe("lead_not_found");
    expect(await db().select().from(schema.crmActivity).where(eq(schema.crmActivity.leadId, stranger.id))).toEqual([]);
    expect((await activity({ leadId: stranger.id, clientId: null })).logged).toMatchObject({ leadId: stranger.id, clientId: null });

    const [brand] = await db().select().from(schema.workClient).where(eq(schema.workClient.parentId, ids.account));
    const own = await createLead({ entityId: ids.szm, clientId: brand.id, companyName: "Vinamilk — Probi", contactName: null, contactTitle: null, email: null, phone: null, need: null, budgetText: null, source: "referral" }, { personId: ids.colleague, sells: true }, null);
    // An enquiry from a brand is its client's account's.
    expect((await activity({ leadId: own.id, clientId: ids.account })).followUp).toMatchObject({ leadId: own.id, clientId: ids.account, ownerPersonId: ids.member });
    // A deal the lead did not become is not the lead's either.
    const [deal] = await db().select().from(schema.crmDeal).where(eq(schema.crmDeal.clientId, ids.account)).limit(1);
    expect(await fails(activity({ leadId: own.id, clientId: ids.account, dealId: deal.id }))).toBe("lead_not_found");
  });
});

describe("erasure on request reaches every copy (CRM-02)", () => {
  const lead = (over: Partial<Parameters<typeof createLead>[0]>) =>
    createLead({ entityId: ids.szm, clientId: null, companyName: "Vinamilk", contactName: "Chị Lan", contactTitle: "Brand manager", email: null, phone: null, need: "Tết", budgetText: null, source: "referral", ...over }, { personId: ids.colleague, sells: true }, null);

  it("blanks the leads that hold the contact, and the email and phone older briefs and hand-off notes copied", async () => {
    const byEmail = await lead({ email: "Lan@Vinamilk.vn" });
    const byPhone = await lead({ companyName: "Sữa Việt", phone: "090 123 4567" });
    const byName = await lead({ clientId: ids.account, contactName: "nguyễn thị lan" });
    const somebodyElse = await lead({ clientId: ids.account, contactName: "Lan Anh", email: "lananh@vinamilk.vn", phone: "0907654321" });
    // What delivery set-up wrote before it stopped copying details.
    const [link] = await db().select({ projectId: schema.crmDealProject.projectId }).from(schema.crmDealProject).innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealProject.dealId)).where(eq(schema.crmDeal.clientId, ids.account));
    const plan = (await readPlan(link.projectId))!;
    await db().update(schema.projectPlan).set({ brief: { ...plan.brief, clientContacts: [{ name: "Nguyễn Thị Lan", role: "decides", contact: "lan@vinamilk.vn · 0901234567" }, { name: "Lan Anh", contact: "lananh@vinamilk.vn" }] } }).where(eq(schema.projectPlan.projectId, link.projectId));
    await db().update(schema.crmDealProject).set({ handoffNote: { context: "Won against two agencies", contacts: "Nguyễn Thị Lan — decides — lan@vinamilk.vn · 0901234567\nLan Anh — lananh@vinamilk.vn" } }).where(eq(schema.crmDealProject.projectId, link.projectId));

    const { after, copies } = await eraseContact(ids.contact);
    expect(after).toMatchObject({ fullName: "Nguyễn Thị Lan", email: null, phone: null });
    expect(copies).toEqual({ leads: 3, briefs: 1, handoffNotes: 1 });
    for (const row of [byEmail, byPhone, byName]) expect(await findLead(row.id)).toMatchObject({ contactName: null, contactTitle: null, email: null, phone: null, need: "Tết" });
    expect(await findLead(somebodyElse.id)).toMatchObject({ contactName: "Lan Anh", email: "lananh@vinamilk.vn", phone: "0907654321" });
    // The name and the role stay where they were; somebody else's line is not touched.
    expect((await readPlan(link.projectId))?.brief.clientContacts).toEqual([{ name: "Nguyễn Thị Lan", role: "decides" }, { name: "Lan Anh", contact: "lananh@vinamilk.vn" }]);
    const [note] = await db().select({ note: schema.crmDealProject.handoffNote }).from(schema.crmDealProject).where(eq(schema.crmDealProject.projectId, link.projectId));
    expect(note.note).toEqual({ context: "Won against two agencies", contacts: "Nguyễn Thị Lan — decides\nLan Anh — lananh@vinamilk.vn" });
  });

  it("erases somebody who is only a lead's contact, once", async () => {
    const { eraseLeadContact } = await import("./leads");
    const only = await lead({ companyName: "Kido", contactName: "Anh Tuấn", email: "tuan@kido.vn", phone: "0912345678" });
    expect((await eraseLeadContact(only.id)).after).toMatchObject({ companyName: "Kido", contactName: null, contactTitle: null, email: null, phone: null, need: "Tết" });
    expect(await fails(eraseLeadContact(only.id))).toBe("lead_contact_erased");
  });
});

describe("the pipeline's pages and board figures (PERF-03)", () => {
  it("pages the list with a count of all, and sums each stage over every deal, not the cards that fit", async () => {
    const { client } = await createAccount({ code: "PGN", name: "Paged Co", entityId: ids.szm, note: null, profile: { legalName: null, taxCode: null, address: null, website: null, industry: null, size: null, source: null, tier: null, contractingEntityId: null }, salesOwnerPersonId: ids.seller, accountManagerPersonId: null, confirmDuplicate: false });
    const stages = await listStages();
    const [open, won, lost] = (["open", "won", "lost"] as const).map((category) => firstStageOf(stages, category)!);
    const deal = (index: number, extra: Partial<typeof schema.crmDeal.$inferInsert> = {}) => ({ code: `DL-PG-${index}`, entityId: ids.szm, clientId: client.id, title: `Paged ${index}`, stageId: open.id, ownerPersonId: ids.seller, oneOffVnd: 10_000_000 * index, monthlyVnd: index % 2 ? 1_000_000 : null, months: index % 2 ? 3 : null, probability: index === 2 ? 35 : null, ...extra });
    await db().insert(schema.crmDeal).values([
      ...[1, 2, 3, 4, 5].map((index) => deal(index)),
      deal(6, { stageId: won.id, status: "won", wonAt: new Date(Date.now() - 5 * 86_400_000) }),
      deal(7, { stageId: lost.id, status: "lost", lostAt: new Date(Date.now() - 60 * 86_400_000) }),
    ]);
    const seller = viewerOf(ids.seller);
    const every = await listDeals(seller, { clientId: client.id, status: "all" });
    expect(every).toHaveLength(7);

    const pages = await Promise.all([1, 2, 3].map((page) => listDealPage(seller, { clientId: client.id, status: "all" }, page, 3)));
    expect(pages.map((page) => page.rows.length)).toEqual([3, 3, 1]);
    expect(pages.every((page) => page.total === 7)).toBe(true);
    expect(pages.flatMap((page) => page.rows.map((row) => row.id))).toEqual(every.map((row) => row.id));
    expect(await listDealPage(viewerOf(ids.colleague), { clientId: client.id, status: "all" }, 1, 3)).toEqual({ rows: [], total: 0 });

    // The board: open deals and those closed in the last 30 days, at most 2 cards — and the figures
    // the page used to sum over the cards it had, summed by Postgres over all six.
    const recent = addDays(today, -30);
    const board = await listDealBoard(seller, { clientId: client.id, status: "all", closedSince: recent }, 2);
    const onBoard = every.filter((row) => row.status === "open" || (row.wonAt ?? row.lostAt ?? new Date(0)).toISOString().slice(0, 10) >= recent);
    expect(onBoard).toHaveLength(6);
    expect(board.deals).toHaveLength(2);
    expect(board.total).toBe(6);
    expect(board.totals).toEqual(pipelineTotals(onBoard));
    // A reader who sees the deals but may not value them: counted, never valued.
    const member: CrmViewer = { principal: principalOf(ids.colleague), ties: new Map([[client.id, ["member"]]]) };
    const valueless = await listDealBoard(member, { clientId: client.id, status: "all", closedSince: recent });
    expect([...valueless.totals.values()].every((row) => row.valued === 0 && row.totalVnd === 0)).toBe(true);
    expect([...valueless.totals.values()].reduce((sum, row) => sum + row.count, 0)).toBe(6);
  });
});
