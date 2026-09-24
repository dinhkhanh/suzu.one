// Value lists shared by the server and the forms. Plain module: never "use client".

// What the person is telling us about the app. "praise" is on purpose: during a roll-out it is
// as useful to know what works as what does not.
export const FEEDBACK_CATEGORIES = ["bug", "idea", "question", "praise", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

// new → in_progress → resolved | declined. A handled item may be reopened (back to in_progress).
export const FEEDBACK_STATUSES = ["new", "in_progress", "resolved", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const OPEN_FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["new", "in_progress"];

// Set by whoever triages, never by the person reporting: "it blocks my work" is their say.
export const FEEDBACK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_REPLY_MAX = 4000;

// Screenshots are uploaded before the feedback exists, so the file is owned by the person who
// uploaded it — the same shape as a request's attachments.
export const FEEDBACK_SCREENSHOT_OWNER_TYPE = "feedback_screenshot";

/** "/projects/abc/tasks" → "projects": the part of the app the feedback is about, for grouping. */
export function areaOfPath(path: string | null | undefined): string | null {
  const first = (path ?? "").split(/[?#]/)[0].split("/").find((part) => part.length > 0);
  return first && /^[a-z][a-z0-9-]{0,39}$/.test(first) ? first : null;
}
