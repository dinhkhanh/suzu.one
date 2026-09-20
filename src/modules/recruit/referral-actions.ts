"use server";
// The referral programme's two mutations (FR-REC-10), each through the one pipeline
// (parse → authenticate → authorize → run → audit).
//
// The audit entry for a referral names the **opening and the referrer**, never the candidate: who
// an employee put forward is the recruiter's business and the referrer's, and the audit log is read
// across the company. The referrer is told the same thing whatever happened, so nothing in the
// result distinguishes a new name from one already on file — see `referrals.ts`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canManageReferrals, canRefer } from "./policy";
import { MAX_REFERRAL_CV_BYTES, findReferral, settleReferralBonus, submitReferral } from "./referrals";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));

/** One link per line; blanks and duplicates dropped, the rest capped by the schema. */
const links = z.preprocess(
  (value) => (typeof value === "string" ? [...new Set(value.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean))] : Array.isArray(value) ? value : []),
  z.array(z.string().max(300)).max(8),
);

const referralFields = z.object({
  openingId: z.uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: optional(z.email().max(200)),
  phone: optional(z.string().trim().max(40)),
  currentTitle: optional(z.string().trim().max(120)),
  currentEmployer: optional(z.string().trim().max(120)),
  links,
  note: optional(z.string().trim().max(2_000)),
});

/**
 * The form posts multipart, because a CV may come with it. The file is optional and everything
 * else is read as a string — `z.object` drops whatever was not asked for, so an extra field is not
 * a hazard. The bytes are checked by the files module (allow-list + magic bytes), not here.
 */
const referralForm = z.instanceof(FormData).transform((form, context) => {
  const fields = referralFields.safeParse(Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")));
  if (!fields.success) {
    for (const issue of fields.error.issues) context.addIssue({ code: "custom", message: issue.code ?? "custom", path: issue.path });
    return z.NEVER;
  }
  const file = form.get("cv");
  const cv = file instanceof File && file.size > 0 ? file : null;
  if (cv && cv.size > MAX_REFERRAL_CV_BYTES) {
    context.addIssue({ code: "custom", message: "file_too_large", path: ["cv"] });
    return z.NEVER;
  }
  return { ...fields.data, cv };
});

const submitReferralPipeline = createAction({
  name: "recruit.referral.submit",
  input: referralForm,
  // Everybody may put a name forward; nothing about the candidate database is thereby opened.
  authorize: (user) => canRefer(user.principal),
  run: async ({ user, input }) => {
    const { cv, ...rest } = input;
    const bytes = cv ? new Uint8Array(await cv.arrayBuffer()) : null;
    await submitReferral({ ...rest, cv: bytes && cv ? { fileName: cv.name, bytes } : null }, user.person.id);
    revalidatePath("/recruit/referrals");
    return {
      data: { received: true },
      audit: {
        resource: { type: "job_opening", id: input.openingId, entityId: null },
        summary: `referral by ${user.person.fullName}`,
        after: { hasCv: !!cv, links: input.links.length },
      },
    };
  },
});

const settleReferralPipeline = createAction({
  name: "recruit.referral.settle",
  input: z.object({ referralId: z.uuid(), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const referral = await findReferral(input.referralId);
    return !!referral && canManageReferrals(user.principal);
  },
  run: async ({ user, input }) => {
    const after = await settleReferralBonus(input.referralId, user.person.id, input.note);
    revalidatePath("/recruit/referrals");
    return {
      data: { id: after.id },
      audit: { resource: { type: "referral", id: after.id, entityId: null }, summary: "referral bonus settled", after: { settledAt: after.bonusSettledAt } },
    };
  },
});

// A `"use server"` file may export nothing but async functions (tests/server-actions.test.ts).

export async function submitReferralAction(input: unknown) {
  return submitReferralPipeline(input);
}

export async function settleReferralBonusAction(input: unknown) {
  return settleReferralPipeline(input);
}
