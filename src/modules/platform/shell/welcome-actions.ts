"use server";
// The first-sign-in guide: confirming it closes it for good; putting it off closes it for this session.
import { cookies } from "next/headers";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getCurrentUser } from "../auth/session";
import { completeWelcome } from "../people/service";
import { WELCOME_LATER_COOKIE } from "./welcome";

const completePipeline = createAction({
  name: "person.welcome.complete",
  input: z.object({}),
  // One's own guide needs no permission.
  authorize: () => true,
  run: async ({ user }) => {
    const first = await completeWelcome(user.person.id);
    return { data: { first }, audit: { resource: { type: "person", id: user.person.id }, summary: first ? "welcome guide completed" : "welcome guide already completed" } };
  },
});
export async function completeWelcomeAction(input: unknown) {
  return completePipeline(input);
}

// Writes nothing but a cookie, so it is not audited: the guide simply opens again at the next sign-in.
// The value is the session's id — never its token — and the cookie is httpOnly.
export async function postponeWelcomeAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  (await cookies()).set(WELCOME_LATER_COOKIE, user.sessionId, { path: "/", httpOnly: true, sameSite: "lax", secure: true });
}
