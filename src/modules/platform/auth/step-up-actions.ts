"use server";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { markReauthenticated, stepUpDriver } from "./step-up";

// The development stand-in for the Google round trip. With the "google" driver (every production
// build: `env()` refuses anything else there) this action refuses everybody.
const confirmPipeline = createAction({
  name: "auth.step_up",
  input: z.object({}),
  // Not from a borrowed session either (FR-PLT-40): the proof would be the impersonator's, not the target's.
  authorize: (user) => stepUpDriver() === "local" && !user.impersonator,
  run: async ({ user }) => {
    await markReauthenticated(user.sessionId);
    return { data: { ok: true }, audit: { resource: { type: "session", id: user.userId }, summary: "local driver" } };
  },
});

export async function confirmLocalStepUpAction(input: unknown) {
  return confirmPipeline(input);
}
