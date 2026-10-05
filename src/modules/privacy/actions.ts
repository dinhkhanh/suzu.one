"use server";
// The privacy tools (NFR-PRV-01..04): the person's own — exporting their data, answering the GPS
// notice and taking the answer back — and HR's anonymisation of a former employee.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { anonymiseFormerEmployee } from "./anonymise";
import { recordConsentEvent, recordGpsAnswer } from "./consents";
import { GPS_NOTICE_VERSION } from "./engine/retention";
import { buildMyDataExport } from "./export";
import { canActForOwnData, canAnonymise } from "./policy";

/**
 * Everything the app holds about the signed-in person, as one JSON file. Their pay is in it, so it
 * takes a fresh step-up like the payslip pages; the audit entry says which kinds of record and how
 * many — never what they say.
 */
const exportPipeline = createAction({
  name: "privacy.export_my_data",
  input: z.object({}),
  stepUp: true,
  authorize: (user) => canActForOwnData(user),
  run: async ({ user }) => {
    const file = await buildMyDataExport({ personId: user.person.id, principal: user.principal });
    return {
      data: { fileName: file.fileName, json: file.json },
      audit: { resource: { type: "person", id: user.person.id, entityId: user.person.primaryEntityId }, summary: `own data exported (${Object.values(file.counts).reduce((sum, value) => sum + value, 0)} records)`, after: file.counts },
    };
  },
});
export async function exportMyDataAction(input: unknown) {
  return exportPipeline(input);
}

/**
 * The person's answer to the GPS notice at check-in, or taking it back (Law 91/2025: as easy to
 * withdraw as to give). "given" and "declined" must answer the notice as it is now — a tab left open
 * across a change of wording is asked again — and are kept with its words.
 */
const gpsPipeline = createAction({
  name: "privacy.gps_notice",
  input: z.object({ decision: z.enum(["given", "declined", "withdrawn"]), version: z.string().max(40).nullable().default(null), locale: z.enum(["vi", "en"]).default("vi") }),
  authorize: (user) => canActForOwnData(user),
  run: async ({ user, input }) => {
    if (input.decision !== "withdrawn" && input.version !== GPS_NOTICE_VERSION) throw new ActionError("notice_changed");
    const event = input.decision === "withdrawn" ? await recordConsentEvent({ personId: user.person.id, purpose: "gps_check_in", decision: "withdrawn" }) : await recordGpsAnswer(user.person.id, input.decision, input.locale);
    revalidatePath("/me");
    revalidatePath("/attendance", "layout");
    return {
      data: { decision: event.decision },
      audit: { resource: { type: "privacy_consent", id: event.id, entityId: user.person.primaryEntityId }, summary: `GPS at check-in: ${event.decision}${event.noticeVersion ? ` (notice ${event.noticeVersion}, ${event.noticeLocale})` : ""}`, after: { purpose: event.purpose, decision: event.decision, noticeVersion: event.noticeVersion } },
    };
  },
});
export async function answerGpsNoticeAction(input: unknown) {
  return gpsPipeline(input);
}

/**
 * HR confirms the anonymisation of a former employee whose retention period is over. The service
 * refuses anybody not due; the audit entry keeps the counts of what went.
 */
const anonymisePipeline = createAction({
  name: "privacy.person_anonymised",
  input: z.object({ personId: z.uuid() }),
  authorize: async (user, input) => canAnonymise(user.principal, await getPersonTarget(input.personId)),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(input.personId);
    const result = await anonymiseFormerEmployee(input.personId, user.person.id, todayInVietnam());
    revalidatePath("/admin/privacy");
    revalidatePath(`/people/${input.personId}`);
    return {
      data: result,
      audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: `personal details anonymised after the retention period (last day ${result.lastDay})`, after: result.removed },
    };
  },
});
export async function anonymisePersonAction(input: unknown) {
  return anonymisePipeline(input);
}
