import { visitorOf } from "@/lib/public-action";
import { MAX_CV_BYTES, applyToOpening } from "@/modules/recruit/public";
import { readFormWithin } from "@/modules/recruit/request-body";

/**
 * Where the public application form posts (FR-REC-03). The **only** unauthenticated write
 * endpoint in the product, so everything here is written for a body that is trying to break it.
 *
 * This file's whole job is to turn a multipart body into plain values and hand them to
 * `applyToOpening`, which is a `createPublicAction` and does the rest: rate limit, spam checks,
 * validation, the work, the audit row. Nothing is decided here, and nothing is trusted here:
 *
 *   · the body is refused **before it is read** if `content-length` says it is too big, so a
 *     100 MB upload costs one header and not 100 MB of memory — and counted as it is read, because
 *     a chunked request declares no length at all;
 *   · exactly one file is taken, by name, and only if it is a `File`;
 *   · every other value is taken as a string, and the schema in `public.ts` caps them all —
 *     `z.object` drops anything that was not asked for, so extra fields are not a hazard;
 *   · the answer is always a redirect, never a body: no JSON, no ids, no stack traces. A failure
 *     goes back to the form with a **message key** in the query string and nothing else.
 */

/** Room for the CV plus the form's text. Anything above this is refused unread. */
const MAX_BODY_BYTES = MAX_CV_BYTES + 256 * 1024;

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** One line per link; blanks and duplicates dropped. Validation is the schema's job, not this one's. */
const linesOf = (value: string, max: number): string[] => [...new Set(value.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean))].slice(0, max);

export async function POST(request: Request, context: RouteContext<"/careers/[slug]/apply">) {
  const { slug } = await context.params;
  // The slug is used to build the redirect, so it is encoded on the way back out; it is never
  // printed into a page and never reaches SQL except as a bound parameter.
  const back = (error?: string) => seeOther(`/careers/${encodeURIComponent(slug)}${error ? `?error=${encodeURIComponent(error)}` : ""}`);

  // Refused unread when the declared length is too big, and counted as it is read otherwise: a
  // chunked body declares no length at all, and a declared one is only what the sender claims.
  const form = await readFormWithin(request, MAX_BODY_BYTES);
  if (form === "too_large") return back("file_too_large");
  // A body that is not a form at all. No detail: a probe learns nothing from the parser.
  if (form === "failed") return back("failed");

  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  const cvField = form.get("cv");
  const cv = cvField instanceof File && cvField.size > 0 ? cvField : null;
  if (cv && cv.size > MAX_CV_BYTES) return back("file_too_large");

  // Answers arrive as `answers.<key>`; the keys are matched against the opening's own questions in
  // the use-case, so an answer to a question nobody asked is dropped rather than stored.
  const answers: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name.startsWith("answers.") && typeof value === "string") answers[name.slice("answers.".length)] = value;
  }

  const visitor = visitorOf(request);
  const result = await applyToOpening(
    {
      slug,
      website: text("website"),
      formToken: text("formToken"),
      fullName: text("fullName"),
      email: text("email"),
      phone: text("phone"),
      location: text("location"),
      currentTitle: text("currentTitle"),
      currentEmployer: text("currentEmployer"),
      links: linesOf(text("links"), 8),
      coverLetter: text("coverLetter"),
      answers,
      salaryExpectationVnd: text("salaryExpectationVnd"),
      // The checkbox is present or it is not; its value is never trusted to mean anything else.
      consent: form.get("consent") !== null,
      talentPool: form.get("talentPool") !== null,
      cv: cv ? { fileName: cv.name, bytes: new Uint8Array(await cv.arrayBuffer()) } : null,
    },
    visitor,
  );

  if (result.ok) return seeOther(`/careers/${encodeURIComponent(slug)}/thanks`);
  // `message` is a message key the page looks up; `error` is the coarse kind. Neither is a sentence.
  return back(result.message ?? result.error);
}

/** Nothing to GET here: the form lives on the opening's page. */
export async function GET(_request: Request, context: RouteContext<"/careers/[slug]/apply">) {
  const { slug } = await context.params;
  return seeOther(`/careers/${encodeURIComponent(slug)}`);
}
