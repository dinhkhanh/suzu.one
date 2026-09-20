"use server";
// Opening a candidate's CV. The file came from the internet, through the public form in
// `public.ts`, and nothing in this system has scanned it — so this is the narrowest download path
// in the product and it says so on the page that offers it.
//
// The rule is the one `policy.ts` states: a CV opens for whoever runs recruitment over the
// opening, for the opening's own hiring team, and for anybody interviewing this candidate —
// reading the CV before the conversation is the conversation. Never on the file id alone, never
// for a colleague, never for finance, never for the auditors. The link is made on click and lives
// for a minute, so no storage URL is ever sitting in a page.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { createDownloadLink, findFile } from "@/modules/platform/files/service";
import { isInterviewerOnApplication } from "./interviews";
import { canOpenCandidateFile } from "./policy";
import { findApplication, findOpening, isOpeningMember } from "./service";

const openCvPipeline = createAction({
  name: "recruit.cv.open",
  input: z.object({ applicationId: z.uuid(), fileId: z.uuid() }),
  // Authorised against the *application*, and the file must be the one that application carries:
  // a valid file id belonging to another candidate is refused exactly like a made-up one.
  authorize: async (user, input) => {
    const application = await findApplication(input.applicationId);
    if (!application || application.cvFileId !== input.fileId) return false;
    const opening = await findOpening(application.openingId);
    if (!opening) return false;
    const [member, interviewing] = await Promise.all([isOpeningMember(opening.id, user.person.id), isInterviewerOnApplication(application.id, user.person.id)]);
    return canOpenCandidateFile(user.principal, { entityId: opening.entityId, departmentId: opening.departmentId, teamId: opening.teamId }, member, interviewing);
  },
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.deletedAt || file.ownerType !== "job_application") throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function openCandidateCvAction(input: unknown) {
  return openCvPipeline(input);
}
