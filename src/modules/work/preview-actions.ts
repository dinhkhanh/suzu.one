"use server";
// The client's review link (D24, FR-PJM-51a), from the inside: making one, and taking it back.
//
// The decision the client makes on the link is **not** here — it arrives without a session, so it
// goes through `createPublicAction` in `preview.ts`, like the careers form. These two are the
// ordinary kind: parse → authenticate → authorize → run → audit.
//
// Neither the token nor the URL ever reaches the audit log. `create` returns the path once, to the
// person who asked for it, and nothing keeps a copy — not the row, not the log, not this file.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { PREVIEW_DEFAULT_DAYS, PREVIEW_LABEL_MAX, PREVIEW_MAX_DAYS, PREVIEW_MESSAGE_MAX, PREVIEW_MIN_DAYS } from "./engine/preview";
import { canManagePreviewLinks, canRevokePreviewLink } from "./preview-policy";
import { createPreviewLink, findPreviewLink, revokePreviewLink } from "./preview";
import { clientOfTask } from "./reviews";
import { loadTask } from "./tasks";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());

const createPipeline = createAction({
  name: "work.preview_link.create",
  input: z.object({
    taskId: z.uuid(),
    deliverableId: optional(z.uuid()),
    label: optional(z.string().trim().max(PREVIEW_LABEL_MAX)),
    message: optional(z.string().trim().max(PREVIEW_MESSAGE_MAX)),
    allowDecision: checkbox.default(true),
    days: z.coerce.number().int().min(PREVIEW_MIN_DAYS).max(PREVIEW_MAX_DAYS).default(PREVIEW_DEFAULT_DAYS),
  }),
  authorize: async (user, input) => {
    const loaded = await loadTask(input.taskId);
    if (!loaded) return false;
    return canManagePreviewLinks(await loadViewer(user), loaded.facts, await clientOfTask(loaded));
  },
  run: async ({ user, input }) => {
    const loaded = (await loadTask(input.taskId))!;
    const { link, path } = await createPreviewLink(input, user.person.id);
    revalidatePath(`/work/tasks/${input.taskId}`);
    return {
      // The one and only copy of the link, on its way to the person who will send it.
      data: { path, expiresAt: link.expiresAt.toISOString() },
      audit: {
        resource: { type: "task:work", id: loaded.task.id, entityId: loaded.task.entityId },
        summary: `${loaded.task.title}: review link for ${link.label ?? "the client"}`,
        // Never the token, and never the path that carries it.
        after: { linkId: link.id, deliverableId: link.deliverableId, allowDecision: link.allowDecision, expiresAt: link.expiresAt.toISOString() },
      },
    };
  },
});
export async function createPreviewLinkAction(input: unknown) {
  return createPipeline(input);
}

const revokePipeline = createAction({
  name: "work.preview_link.revoke",
  input: z.object({ linkId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findPreviewLink(input.linkId);
    if (!found) return false;
    return canRevokePreviewLink(await loadViewer(user), found.loaded.facts, await clientOfTask(found.loaded));
  },
  run: async ({ user, input }) => {
    const { loaded } = (await findPreviewLink(input.linkId))!;
    const link = await revokePreviewLink(input.linkId, user.person.id);
    revalidatePath(`/work/tasks/${loaded.task.id}`);
    return {
      data: { id: link.id },
      audit: {
        resource: { type: "task:work", id: loaded.task.id, entityId: loaded.task.entityId },
        summary: `${loaded.task.title}: review link revoked`,
        after: { linkId: link.id, revokedAt: link.revokedAt?.toISOString() ?? null },
      },
    };
  },
});
export async function revokePreviewLinkAction(input: unknown) {
  return revokePipeline(input);
}
