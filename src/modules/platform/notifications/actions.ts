"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { CATEGORIES, EMAIL_CHANNELS } from "./kinds";
import { deliverPendingPushes, getPreferences, markRead, queueTestPush, removePushSubscription, savePushSubscription, setPreferences } from "./service";

const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

// Everything here acts on the caller's own notifications only; the services take their person id.
const markReadPipeline = createAction({
  name: "notification.read",
  input: z.object({ id: z.uuid().nullable().default(null) }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const marked = await markRead(user.person.id, input.id);
    revalidatePath("/", "layout");
    return { data: { marked }, audit: { resource: { type: "notification", id: input.id }, summary: `${marked} read` } };
  },
});

export async function markNotificationsReadAction(input: unknown) {
  return markReadPipeline(input);
}

const preferencesPipeline = createAction({
  name: "notification.preferences",
  input: z.object({ choices: z.partialRecord(z.enum(CATEGORIES), z.object({ inApp: checkbox, email: z.enum(EMAIL_CHANNELS), push: checkbox })) }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const before = await getPreferences(user.person.id);
    const after = await setPreferences(user.person.id, input.choices);
    revalidatePath("/notifications");
    return { data: after, audit: { resource: { type: "notification_preference", id: user.person.id }, before, after } };
  },
});

export async function saveNotificationPreferencesAction(input: unknown) {
  return preferencesPipeline(input);
}

// ── Web push: this device, for the caller only ──────────────────────────────────────────────

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);

const subscribePipeline = createAction({
  name: "notification.push.subscribe",
  // What `PushSubscription.toJSON()` gives the page. https only: a push service is never anything else.
  input: z.object({ endpoint: z.url({ protocol: /^https$/ }).max(1000), keys: z.object({ p256dh: base64url.min(80).max(120), auth: base64url.min(16).max(40) }) }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const row = await savePushSubscription(user.person.id, { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: user.request.userAgent?.slice(0, 400) ?? null });
    revalidatePath("/notifications");
    // The endpoint is a capability URL: its host says which browser vendor, the rest stays out of the log.
    return { data: { id: row.id }, audit: { resource: { type: "push_subscription", id: row.id }, summary: new URL(input.endpoint).host } };
  },
});
export async function subscribePushAction(input: unknown) {
  return subscribePipeline(input);
}

const unsubscribePipeline = createAction({
  name: "notification.push.unsubscribe",
  input: z.object({ endpoint: z.string().max(1000).nullable().default(null) }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const removed = await removePushSubscription(user.person.id, input.endpoint);
    revalidatePath("/notifications");
    return { data: { removed }, audit: { resource: { type: "push_subscription", id: user.person.id }, summary: `${removed} removed` } };
  },
});
export async function unsubscribePushAction(input: unknown) {
  return unsubscribePipeline(input);
}

const testPushPipeline = createAction({
  name: "notification.push.test",
  input: z.object({}),
  authorize: () => true,
  run: async ({ user }) => {
    const devices = await queueTestPush(user.person.id, { title: "Suzu One", body: "Thông báo đẩy đang hoạt động trên thiết bị này.", link: "/notifications" });
    const tally = await deliverPendingPushes();
    return { data: { devices, ...tally }, audit: { resource: { type: "push_subscription", id: user.person.id }, summary: `test push to ${devices} device(s)` } };
  },
});
export async function sendTestPushAction(input: unknown) {
  return testPushPipeline(input);
}
