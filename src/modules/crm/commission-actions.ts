"use server";
// Sales commission (FR-CRM-45). A scheme is proposed by the sales director or C&B and decided by
// the owner; statements are worked out and confirmed by C&B. Every action moves or reveals
// compensation, so every one asks for a recent re-authentication (FR-PLT-06), and the audit keeps
// the scheme (a rule, not anybody's pay) and, for a statement, ids and the month — never an amount.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { canDecideCommissionScheme, canProposeCommissionScheme, canRunCommission, computeCommission, confirmStatement, decideCommissionScheme, proposeCommissionScheme } from "./commission";
import { COMMISSION_EARNERS } from "./enums";
import { blankToNull, isoDate, month, optional } from "./form-inputs";

const vndText = z.preprocess((value) => (typeof value === "string" ? Number(value.replace(/[.,\s_]/g, "")) : value), z.number().int().min(0).max(1e13));
const percent = z.preprocess((value) => (typeof value === "string" ? Number(value.replace(",", ".")) : value), z.number().min(0).max(30));
const share = z.preprocess(blankToNull, z.coerce.number().min(0).max(100).nullable().default(null));

const refresh = () => revalidatePath("/crm/commission");

const proposeSchemePipeline = createAction({
  name: "crm_commission_scheme.propose",
  stepUp: true,
  input: z.object({
    entityId: optional(z.uuid()),
    name: z.string().trim().min(1).max(120),
    validFrom: isoDate,
    earner: z.enum(COMMISSION_EARNERS),
    splitOwnerPercent: share,
    tierFrom: z.array(z.string()).max(8).default([]),
    tierRate: z.array(z.string()).max(8).default([]),
  }),
  authorize: (user) => canProposeCommissionScheme(user.principal),
  run: async ({ user, input }) => {
    // The tiers come as two parallel lists (a row per tier); a row left blank is not a tier.
    const tiers = input.tierFrom
      .map((from, index) => ({ from: from.trim(), rate: (input.tierRate[index] ?? "").trim() }))
      .filter((row) => row.from !== "" || row.rate !== "")
      .map((row) => {
        const from = vndText.safeParse(row.from || "0");
        const rate = percent.safeParse(row.rate || "0");
        if (!from.success || !rate.success) throw new ActionError("commission_tiers");
        return { fromVnd: from.data, rateBp: Math.round(rate.data * 100) };
      });
    if (tiers.length === 0) throw new ActionError("commission_tiers");
    const created = await proposeCommissionScheme({ entityId: input.entityId, name: input.name, validFrom: input.validFrom, rule: { base: "cash_collected", earner: input.earner, splitOwnerBp: Math.round((input.splitOwnerPercent ?? 100) * 100), tiers } }, user.person.id);
    refresh();
    return { data: { id: created.id }, audit: { resource: { type: "crm_commission_scheme", id: created.id, entityId: created.entityId }, summary: `quy chế hoa hồng "${created.name}" từ ${created.validFrom}`, after: created } };
  },
});
export async function proposeCommissionSchemeAction(input: unknown) {
  return proposeSchemePipeline(input);
}

const decideSchemePipeline = createAction({
  name: "crm_commission_scheme.decide",
  stepUp: true,
  input: z.object({ id: z.uuid(), decision: z.enum(["approved", "rejected"]) }),
  authorize: (user) => canDecideCommissionScheme(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decideCommissionScheme(input.id, input.decision, user.person.id);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "crm_commission_scheme", id: after.id, entityId: after.entityId }, summary: `${input.decision === "approved" ? "duyệt" : "từ chối"} quy chế hoa hồng "${after.name}"`, before, after } };
  },
});
export async function decideCommissionSchemeAction(input: unknown) {
  return decideSchemePipeline(input);
}

const computePipeline = createAction({
  name: "crm_commission.compute",
  stepUp: true,
  input: z.object({ month }),
  authorize: (user) => canRunCommission(user.principal),
  run: async ({ input }) => {
    const result = await computeCommission(input.month);
    refresh();
    return { data: result, audit: { resource: { type: "crm_commission_month", id: input.month }, summary: `tính hoa hồng tháng ${input.month}: ${result.written} bảng kê`, after: result } };
  },
});
export async function computeCommissionAction(input: unknown) {
  return computePipeline(input);
}

const confirmPipeline = createAction({
  name: "crm_commission.confirm",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  // Checked against the statement's person inside the service, under the row lock.
  authorize: (user) => canRunCommission(user.principal),
  run: async ({ user, input }) => {
    const { after, posted } = await confirmStatement(input.id, user.principal, user.person.id);
    refresh();
    return { data: { posted }, audit: { resource: { type: "crm_commission_statement", id: after.id, entityId: after.entityId }, summary: `xác nhận bảng kê hoa hồng tháng ${after.month}${posted ? ", đưa vào kỳ lương" : ""}`, after: { id: after.id, personId: after.personId, month: after.month, status: after.status, payrollRunId: after.payrollRunId } } };
  },
});
export async function confirmCommissionStatementAction(input: unknown) {
  return confirmPipeline(input);
}
