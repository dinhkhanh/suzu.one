import { visitorOf } from "@/lib/public-action";
import { MAX_SUBMISSION_BYTES, submitAssignment } from "@/modules/recruit/assignments";
import { readFormWithin } from "@/modules/recruit/request-body";

/**
 * Where a candidate's take-home comes back (FR-REC-07). The second — and last — unauthenticated
 * write endpoint in the product, written to the same rules as the application form next door:
 *
 *   · the body is refused **before it is read** if `content-length` says it is too big, and
 *     counted as it is read, because a chunked request declares no length at all;
 *   · exactly one file is taken, by name, and only if it is a `File`;
 *   · every other value is a string, and the schema in `assignments.ts` caps them all;
 *   · the answer is always a redirect. No JSON, no ids, no stack traces; a failure carries a
 *     **message key** in the query string and nothing else.
 */

const MAX_BODY_BYTES = MAX_SUBMISSION_BYTES + 256 * 1024;

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** One link per line; blanks and duplicates dropped. Validation belongs to the schema. */
const linesOf = (value: string, max: number): string[] => [...new Set(value.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean))].slice(0, max);

export async function POST(request: Request, context: RouteContext<"/careers/assignment/[token]/submit">) {
  const { token } = await context.params;
  const back = (error?: string) => seeOther(`/careers/assignment/${encodeURIComponent(token)}${error ? `?error=${encodeURIComponent(error)}` : ""}`);

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

  const fileField = form.get("file");
  const file = fileField instanceof File && fileField.size > 0 ? fileField : null;
  if (file && file.size > MAX_SUBMISSION_BYTES) return back("file_too_large");

  const result = await submitAssignment(
    {
      token,
      website: text("website"),
      note: text("note"),
      links: linesOf(text("links"), 5),
      file: file ? { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
    },
    visitorOf(request),
  );

  if (result.ok) return seeOther(`/careers/assignment/${encodeURIComponent(token)}/thanks`);
  return back(result.message ?? result.error);
}

/** Nothing to GET here: the form lives on the brief. */
export async function GET(_request: Request, context: RouteContext<"/careers/assignment/[token]/submit">) {
  const { token } = await context.params;
  return seeOther(`/careers/assignment/${encodeURIComponent(token)}`);
}
