"use server";
// Quotes (FR-CRM-21..23) and the configuration they rest on: the rate card (FR-CRM-20) and the
// pipeline's stages (FR-CRM-12). A quote follows its deal: whoever may change the deal drafts,
// sends and records the client's answer; the approval itself is the approval engine's.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import type { CurrentUser } from "../platform/auth/session";
import { getRequest } from "../platform/approvals/service";
import { CHANNELS, CONTENT_FORMATS } from "@/modules/work/service";
import { dealContext } from "./deals";
import { SERVICE_LINES, SERVICE_UNITS, STAGE_CATEGORIES, STAGE_GATES } from "./enums";
import { checkbox, hoursToMinutes, isoDate, optional, percentBp, rows, text, vnd } from "./form-inputs";
import { canConfigureCrm, canEditQuotes, canPriceForEntity } from "./policy";
import { answerQuote, createQuote, decideQuote, findQuote, quoteRequestType, reviseQuote, saveQuote, sendQuote, submitQuote, withdrawQuote } from "./quotes";
import { saveService, setPrice } from "./rate-card";
import { saveStage } from "./stages";
import { loadCrm } from "./viewer";

async function mayEditQuotesOf(user: CurrentUser, dealId: string): Promise<boolean> {
  const [{ viewer }, context] = await Promise.all([loadCrm(user), dealContext(dealId)]);
  return !!context && canEditQuotes(viewer, context.facts);
}

async function mayEditQuote(user: CurrentUser, quoteId: string): Promise<boolean> {
  const quote = await findQuote(quoteId);
  return !!quote && mayEditQuotesOf(user, quote.dealId);
}

function refreshQuote(dealId: string, quoteId?: string) {
  revalidatePath(`/crm/deals/${dealId}`);
  if (quoteId) revalidatePath(`/crm/deals/${dealId}/quotes/${quoteId}`);
  revalidatePath("/crm/deals");
}

const auditQuote = (quoteId: string) => ({ type: "crm_quote", id: quoteId });

const createQuotePipeline = createAction({
  name: "crm.quote.create",
  input: z.object({ dealId: z.uuid() }),
  authorize: (user, input) => mayEditQuotesOf(user, input.dealId),
  run: async ({ user, input }) => {
    const quote = await createQuote(input.dealId, user.person.id);
    refreshQuote(input.dealId, quote.id);
    return { data: { id: quote.id }, audit: { resource: auditQuote(quote.id), summary: `${quote.number} v${quote.version}` } };
  },
});
export async function createQuoteAction(input: unknown) {
  return createQuotePipeline(input);
}

// Hours by role for a line, posted as "lines.0.roles.0.role" / "lines.0.roles.0.hours".
const roleRow = z.object({ role: z.string().trim().max(80), hours: hoursToMinutes });
const lineRow = z.object({
  serviceId: optional(z.uuid()),
  title: z.string().trim().min(1).max(200),
  description: text(1000),
  quantity: z.coerce.number().int().min(1).max(100_000),
  unit: text(40),
  unitPriceVnd: vnd.transform((value) => value ?? 0),
  discountPercent: percentBp,
  months: optional(z.coerce.number().int().min(1).max(120)),
  format: optional(z.enum(CONTENT_FORMATS)),
  channel: optional(z.enum(CHANNELS)),
  roles: rows(roleRow, 12).default([]),
});

const saveQuotePipeline = createAction({
  name: "crm.quote.save",
  input: z.object({ quoteId: z.uuid(), title: z.string().trim().min(1).max(200), validUntil: optional(isoDate), vatRateBp: z.coerce.number().int().min(0).max(10_000), intro: text(4000), terms: text(4000), lines: rows(lineRow, 100) }),
  authorize: (user, input) => mayEditQuote(user, input.quoteId),
  run: async ({ input }) => {
    const { before, after } = await saveQuote(input.quoteId, {
      title: input.title,
      validUntil: input.validUntil,
      vatRateBp: input.vatRateBp,
      intro: input.intro,
      terms: input.terms,
      lines: input.lines.map((line) => ({ serviceId: line.serviceId, title: line.title, description: line.description, quantity: line.quantity, unit: line.unit, unitPriceVnd: line.unitPriceVnd, discountBp: line.discountPercent, months: line.months, format: line.format, channel: line.channel, roleMinutes: line.roles.filter((role) => role.role && role.hours > 0).map((role) => ({ role: role.role, minutes: role.hours })) })),
    });
    refreshQuote(after.dealId, after.id);
    return { data: { id: after.id, totalVnd: after.totalVnd }, audit: { resource: auditQuote(after.id), before: { totalVnd: before.totalVnd, maxDiscountBp: before.maxDiscountBp }, after: { totalVnd: after.totalVnd, maxDiscountBp: after.maxDiscountBp } } };
  },
});
export async function saveQuoteAction(input: unknown) {
  return saveQuotePipeline(input);
}

const quoteStepPipeline = createAction({
  name: "crm.quote.step",
  input: z.object({ quoteId: z.uuid(), step: z.enum(["submit", "withdraw", "send", "accept", "reject", "revise"]), note: text(1000) }),
  authorize: (user, input) => mayEditQuote(user, input.quoteId),
  run: async ({ user, input }) => {
    const quote = (await findQuote(input.quoteId))!;
    let resultId = quote.id;
    let status: string = quote.status;
    // Whether the margin rule could be applied when the quote was submitted or sent as a draft.
    let marginChecked: boolean | null = null;
    if (input.step === "submit") {
      const submitted = await submitQuote(input.quoteId, user.person.id);
      status = submitted.quote.status;
      marginChecked = submitted.marginChecked;
    } else if (input.step === "withdraw") status = (await withdrawQuote(input.quoteId, user.person.id)).after.status;
    else if (input.step === "send") {
      // A draft the rules ask about comes back "in approval", not refused: the margin is judged here.
      const sent = await sendQuote(input.quoteId, user.person.id);
      status = sent.after.status;
      marginChecked = sent.check?.marginChecked ?? null;
    }
    else if (input.step === "accept" || input.step === "reject") status = (await answerQuote(input.quoteId, input.step === "accept", input.note)).after.status;
    else {
      const revised = await reviseQuote(input.quoteId, user.person.id);
      resultId = revised.id;
      status = revised.status;
    }
    refreshQuote(quote.dealId, resultId);
    revalidatePath("/approvals");
    // A quote that left without its margin being checked says so on its trail — never the margin itself.
    const unchecked = marginChecked === false;
    return { data: { id: resultId, status }, audit: { resource: auditQuote(input.quoteId), summary: `${input.step} → ${status}${unchecked ? " (margin not checked: no cost rate)" : ""}`, before: { status: quote.status }, after: { status, ...(marginChecked === null ? {} : { marginChecked }) } } };
  },
});
export async function quoteStepAction(input: unknown) {
  return quoteStepPipeline(input);
}

const decidePipeline = createAction({
  name: "crm.quote.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  authorize: async (user, input) => !!(await getRequest({ personId: user.person.id, principal: user.principal }, quoteRequestType, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { before, after, outcome } = await decideQuote(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    refreshQuote(after.dealId, after.id);
    revalidatePath("/approvals");
    return { data: { outcome }, audit: { resource: auditQuote(after.id), summary: outcome, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function decideQuoteAction(input: unknown) {
  return decidePipeline(input);
}

// ── Rate card ───────────────────────────────────────────────────────────────────────────────

const servicePipeline = createAction({
  name: "crm.service.save",
  input: z.object({
    serviceId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/),
    name: z.string().trim().min(1).max(200),
    nameEn: text(200),
    category: z.enum(SERVICE_LINES),
    unit: z.enum(SERVICE_UNITS),
    isRecurring: checkbox.default(false),
    format: optional(z.enum(CONTENT_FORMATS)),
    channel: optional(z.enum(CHANNELS)),
    roles: rows(roleRow, 12).default([]),
    description: text(1000),
    isActive: checkbox.default(true),
  }),
  authorize: async (user) => canConfigureCrm((await loadCrm(user)).viewer),
  run: async ({ input }) => {
    const { serviceId, roles, ...values } = input;
    const { before, after } = await saveService(serviceId, { ...values, roleMinutes: roles.filter((role) => role.role && role.hours > 0).map((role) => ({ role: role.role, minutes: role.hours })) });
    revalidatePath("/crm/rate-card");
    return { data: { id: after.id }, audit: { resource: { type: "crm_service", id: after.id }, before, after } };
  },
});
export async function saveServiceAction(input: unknown) {
  return servicePipeline(input);
}

const pricePipeline = createAction({
  name: "crm.service.price",
  input: z.object({ serviceId: z.uuid(), entityId: optional(z.uuid()), priceVnd: vnd.refine((value) => value !== null), validFrom: isoDate }),
  authorize: async (user, input) => {
    const { viewer } = await loadCrm(user);
    return input.entityId ? canPriceForEntity(viewer, input.entityId) : canConfigureCrm(viewer);
  },
  run: async ({ user, input }) => {
    const row = await setPrice(input.serviceId, { entityId: input.entityId, priceVnd: input.priceVnd!, validFrom: input.validFrom }, user.person.id);
    revalidatePath("/crm/rate-card");
    return { data: { id: row.id }, audit: { resource: { type: "crm_service", id: input.serviceId, entityId: input.entityId }, after: row } };
  },
});
export async function setPriceAction(input: unknown) {
  return pricePipeline(input);
}

// ── Stages ──────────────────────────────────────────────────────────────────────────────────

const stagePipeline = createAction({
  name: "crm.stage.save",
  input: z.object({
    stageId: optional(z.uuid()),
    name: z.string().trim().min(1).max(80),
    nameEn: text(80),
    category: z.enum(STAGE_CATEGORIES),
    probability: z.coerce.number().int().min(0).max(100),
    gates: z.preprocess((value) => (value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(z.enum(STAGE_GATES))),
    allowsPitch: checkbox.default(false),
    sortOrder: z.coerce.number().int().min(0).max(10_000),
    isActive: checkbox.default(true),
  }),
  authorize: async (user) => canConfigureCrm((await loadCrm(user)).viewer),
  run: async ({ input }) => {
    const { stageId, ...values } = input;
    const { before, after } = await saveStage(stageId, values);
    revalidatePath("/crm/settings");
    revalidatePath("/crm/deals");
    return { data: { id: after.id }, audit: { resource: { type: "crm_stage", id: after.id }, before, after } };
  },
});
export async function saveStageAction(input: unknown) {
  return stagePipeline(input);
}
