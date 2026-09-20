"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { acknowledgeAnnouncement, type AnnouncementRow, commsViewerOf, createAnnouncement, loadAnnouncement, mayManage, mayPostTo, mayRead, publishAnnouncement, setAnnouncementState, updateAnnouncement } from "./announcements";
import { KUDOS_MESSAGE_MAX, parseAudienceKey } from "./enums";
import { findKudos, findRecipient, giveKudos, mayRemoveKudos, removeKudos } from "./kudos";
import { canGiveKudos } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

// <input type="datetime-local"> has no zone: the office's clock is Vietnam's.
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const vietnamTime = optional(z.string().regex(LOCAL_TIME)).transform((value) => (value ? new Date(`${value.length === 16 ? `${value}:00` : value}+07:00`) : null));

// A knowledge-base page: its id, or a link to it pasted from the address bar.
const UUID_IN_LINK = /(?:^|\/kb\/pages\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#].*)?$/i;
const kbPage = optional(z.string().trim().max(300).regex(UUID_IN_LINK)).transform((value) => (value ? value.match(UUID_IN_LINK)![1].toLowerCase() : null));

const audience = z.preprocess((value) => (typeof value === "string" ? [value] : value), z.array(z.string().max(60).refine((key) => parseAudienceKey(key) !== null)).min(1).max(50));

const auditOf = (row: Pick<AnnouncementRow, "id" | "entityId">) => ({ type: "announcement", id: row.id, entityId: row.entityId });
// What the audit log keeps: the facts, not the prose.
const facts = (row: AnnouncementRow, audienceKeys?: readonly string[]) => ({ title: row.title, status: row.status, pinned: row.pinned, mustAcknowledge: row.mustAcknowledge, publishAt: row.publishAt, expiresAt: row.expiresAt, kbPageId: row.kbPageId, ...(audienceKeys ? { audience: audienceKeys } : {}) });

function refresh(id?: string) {
  revalidatePath("/home");
  revalidatePath("/announcements", "layout");
  if (id) revalidatePath(`/announcements/${id}`);
}

const saveAnnouncementPipeline = createAction({
  name: "comms.announcement.save",
  input: z.object({
    id: optional(z.uuid()),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    kbPageId: kbPage,
    pinned: checkbox,
    mustAcknowledge: checkbox,
    expiresAt: vietnamTime,
    publishAt: vietnamTime,
    audience,
    intent: z.enum(["draft", "publish"]).default("draft"),
  }),
  // The new audience must be the author's to address — and an existing announcement theirs to manage.
  authorize: async (user, input) => {
    if (!(await mayPostTo(user.principal, input.audience))) return false;
    if (!input.id) return true;
    const loaded = await loadAnnouncement(input.id);
    return !!loaded && mayManage(user.principal, loaded);
  },
  run: async ({ user, input }) => {
    const { id, intent, publishAt, ...values } = input;
    // Checked before anything is written, so a refused publication leaves no stray draft behind.
    const shownFrom = publishAt && publishAt > new Date() ? publishAt : new Date();
    if (intent === "publish" && values.expiresAt && values.expiresAt <= shownFrom) throw new ActionError("comms_expires_before_publish");
    const saved = id ? await updateAnnouncement(id, values) : null;
    let row = saved?.after ?? (await createAnnouncement(values, user.person.id));
    let notified = 0;
    if (intent === "publish") ({ after: row, notified } = await publishAnnouncement(row.id, publishAt));
    refresh(row.id);
    return { data: { id: row.id, notified }, audit: { resource: auditOf(row), summary: row.title, before: saved ? facts(saved.before, saved.audienceBefore) : undefined, after: { ...facts(row, values.audience), notified } } };
  },
});
export async function saveAnnouncementAction(input: unknown) {
  return saveAnnouncementPipeline(input);
}

const canManageById = async (user: { principal: Parameters<typeof mayManage>[0] }, id: string) => {
  const loaded = await loadAnnouncement(id);
  return !!loaded && mayManage(user.principal, loaded);
};

const stateAnnouncementPipeline = createAction({
  name: "comms.announcement.state",
  input: z.object({ id: z.uuid(), change: z.enum(["archive", "pin", "unpin"]) }),
  authorize: (user, input) => canManageById(user, input.id),
  run: async ({ input }) => {
    const { before, after } = await setAnnouncementState(input.id, input.change === "archive" ? { archive: true } : { pinned: input.change === "pin" });
    refresh(after.id);
    return { data: { id: after.id }, audit: { resource: auditOf(after), summary: `${input.change}: ${after.title}`, before: facts(before), after: facts(after) } };
  },
});
export async function setAnnouncementStateAction(input: unknown) {
  return stateAnnouncementPipeline(input);
}

const acknowledgeAnnouncementPipeline = createAction({
  name: "comms.announcement.acknowledge",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const loaded = await loadAnnouncement(input.id);
    return !!loaded && mayRead(await commsViewerOf(user), loaded);
  },
  run: async ({ user, input }) => {
    const { row, first } = await acknowledgeAnnouncement(await commsViewerOf(user), input.id);
    refresh(row.id);
    return { data: { first }, audit: { resource: auditOf(row), summary: row.title, after: { acknowledged: true, first } } };
  },
});
export async function acknowledgeAnnouncementAction(input: unknown) {
  return acknowledgeAnnouncementPipeline(input);
}

// ── Kudos ───────────────────────────────────────────────────────────────────────────────────

const giveKudosPipeline = createAction({
  name: "comms.kudos.give",
  input: z.object({ toPersonId: z.uuid(), valueKey: z.string().trim().min(1).max(60), message: z.string().trim().min(1).max(KUDOS_MESSAGE_MAX) }),
  authorize: async (user, input) => {
    const to = await findRecipient(input.toPersonId);
    return !!to && canGiveKudos(user.principal, to);
  },
  run: async ({ user, input }) => {
    const row = await giveKudos({ personId: user.person.id, fullName: user.person.fullName, principal: user.principal }, input);
    revalidatePath("/home");
    revalidatePath("/kudos");
    return { data: { id: row.id }, audit: { resource: { type: "kudos", id: row.id }, summary: input.valueKey, after: { toPersonId: row.toPersonId, valueKey: row.valueKey } } };
  },
});
export async function giveKudosAction(input: unknown) {
  return giveKudosPipeline(input);
}

const removeKudosPipeline = createAction({
  name: "comms.kudos.remove",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findKudos(input.id);
    return !!found && mayRemoveKudos(user.principal, found);
  },
  run: async ({ user, input }) => {
    const found = await findKudos(input.id);
    if (!found) throw new ActionError("comms_kudos_not_found");
    const row = await removeKudos(input.id, user.person.id);
    revalidatePath("/home");
    revalidatePath("/kudos");
    return { data: { id: row.id }, audit: { resource: { type: "kudos", id: row.id, entityId: found.to.entityId ?? null }, summary: "removed", before: { fromPersonId: row.fromPersonId, toPersonId: row.toPersonId, valueKey: row.valueKey } } };
  },
});
export async function removeKudosAction(input: unknown) {
  return removeKudosPipeline(input);
}
