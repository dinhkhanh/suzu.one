// Value lists shared by the server and the client. A plain module on purpose: constants exported
// from a "use client" file are client references on the server, and constants exported from a
// `server-only` file cannot be reached from a form.

/** How the "new request" screen groups the types. */
export const REQUEST_CATEGORIES = ["purchase", "finance", "hr", "it", "admin", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

/**
 * Who owns an attachment while a request is being filled in: the person who uploaded it. The
 * request does not exist yet, so it cannot own anything.
 *
 * It lives here and not beside the upload actions because a `"use server"` file may export nothing
 * but async functions — a single exported const makes the whole module export *nothing*, and
 * typecheck, lint and the tests all miss it (the same trap the payroll security review found).
 */
export const ATTACHMENT_OWNER_TYPE = "request_attachment";
