// Values and shapes the assistant's client components share with its server code.
//
// A PLAIN MODULE ON PURPOSE. `conversations.ts` is `server-only` and reaches the database driver;
// a `"use client"` file that imports a *value* from it pulls postgres into the browser bundle and
// the page fails at runtime — `tsc` and eslint both pass, so only opening the page finds it. The
// same trap as the one `core-hr/enums.ts` exists for, from the other direction.
import type { Citation } from "./engine/answer";

export const QUESTION_MAX = 500;

/** One turn as the chat renders it: no dates, no rows, nothing that needs the database. */
export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  outcome: "answered" | "unanswered" | "refused" | null;
  citations: Citation[];
};
