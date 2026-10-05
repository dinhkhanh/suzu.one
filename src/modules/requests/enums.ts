// Value lists shared by the server and the client. A plain module on purpose: constants exported
// from a "use client" file are client references on the server, and constants exported from a
// `server-only` file cannot be reached from a form.

/** How the "new request" screen groups the types. */
export const REQUEST_CATEGORIES = ["purchase", "finance", "hr", "it", "admin", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

/**
 * What finance does once a request of the type is approved (REQ-01): nothing, pay it (a payment or
 * a purchase), or pay it as an advance that a later payment under the same parent is netted
 * against. An expense claim is none of these: it is paid through the payroll run.
 */
export const REQUEST_PAYOUTS = ["none", "payment", "advance"] as const;
export type RequestPayout = (typeof REQUEST_PAYOUTS)[number];

/**
 * Who owns an attachment while a request is being filled in: the person who uploaded it. The
 * request does not exist yet, so it cannot own anything.
 *
 * It lives here and not beside the upload actions because a `"use server"` file may export nothing
 * but async functions — a single exported const makes the whole module export *nothing*, and
 * typecheck, lint and the tests all miss it (the same trap the payroll security review found).
 */
export const ATTACHMENT_OWNER_TYPE = "request_attachment";
