// Value lists shared by the server and the client. A plain module on purpose: constants exported
// from a "use client" file are client references on the server, and constants exported from a
// `server-only` file cannot be reached from a form.

/** How the "new request" screen groups the types. */
export const REQUEST_CATEGORIES = ["purchase", "finance", "hr", "it", "admin", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];
