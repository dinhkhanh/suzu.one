"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { CATEGORIES, EMAIL_CHANNELS } from "./kinds";
import { getPreferences, markRead, setPreferences } from "./service";

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
  input: z.object({ choices: z.partialRecord(z.enum(CATEGORIES), z.object({ inApp: checkbox, email: z.enum(EMAIL_CHANNELS) })) }),
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
