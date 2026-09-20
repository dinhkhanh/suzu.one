import "server-only";
import { createHmac } from "node:crypto";
import type { z } from "zod";
import { ActionError } from "@/lib/action";
import { env } from "@/lib/env";
import { type AuditEntry, recordAudit } from "@/modules/platform/audit/service";

/**
 * The mutation pipeline for the **one unauthenticated surface** in the product: the careers page's
 * application form (FR-REC-03). `createAction()` cannot serve it — its second step is
 * `getCurrentUser()`, and there is nobody there — so this is its sibling, and it is deliberately
 * *stricter* rather than looser:
 *
 *   parse → rate limit → spam check → run → audit
 *
 * Every step is a **required** field of the definition, exactly as in `createAction`: a public
 * mutation cannot be written that forgets its rate limit, because it would not compile. The
 * limiter itself lives in the owning module (it needs a table), so what arrives here is the
 * module's function — but supplying one is not optional.
 *
 * Three rules about what comes back, because the caller is a stranger:
 *   · a failure is a **message key**, never a sentence, an id, a row count or an exception;
 *   · the *same* refusal is used for "we dropped this" and "we quietly accepted it" where telling
 *     the two apart would say something (see `spamCheck` below);
 *   · nothing that the run produced leaks unless the action says so in `data`.
 */

export type PublicActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "invalid" | "rate_limited" | "rejected" | "failed"; message?: string };

/** Everything known about the caller. Never their address: see `visitorOf`. */
export type Visitor = { ipHash: string; userAgent: string | null };

export type RateLimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * What the spam checks decided. `"drop"` is the interesting one: the submission is **answered as
 * if it had succeeded** and nothing is written, because a bot that is told it was caught tries
 * again differently, and a human who trips a honeypot is a bug worth seeing in the audit log
 * rather than an error worth showing.
 */
export type SpamVerdict = { verdict: "ok" } | { verdict: "drop"; reason: string } | { verdict: "refuse"; reason: string };

type AuditDetails = Omit<AuditEntry, "actor" | "request" | "action">;

/**
 * Who is asking, as far as anything is ever allowed to know. **The address itself is never stored
 * or logged**: it is keyed through HMAC-SHA-256 with the application secret and kept as 16 hex
 * characters, which is enough to count submissions per visitor for an hour and not enough to
 * recover the address or to join it to anything else (PDPL data minimisation, SRS §2.3).
 *
 * `x-forwarded-for` is only as good as the proxy in front of it. On Vercel it is set by the edge
 * and the left-most entry is the client; on a machine with no proxy it is absent and the limiter
 * falls back to a single bucket, which is the safe direction — everyone shares one allowance.
 */
export function visitorOf(request: { headers: Headers }): Visitor {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  const ipHash = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`visitor:${address}`).digest("hex").slice(0, 16);
  return { ipHash, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null };
}

export function createPublicAction<Schema extends z.ZodType, Output>(definition: {
  /** Audit action name, e.g. "careers.apply". Refusals are recorded under `<name>.<why>`. */
  name: string;
  input: Schema;
  /** Counted per visitor by the owning module. Called once, before anything is read or written. */
  rateLimit: (context: { visitor: Visitor }) => Promise<RateLimitOutcome>;
  /** Honeypot, form token, anything cheap that does not touch the database. */
  spamCheck: (input: z.output<Schema>, context: { visitor: Visitor }) => SpamVerdict;
  /** What the caller is told when a submission is silently dropped — the success answer. */
  dropped: () => Output;
  run: (context: { input: z.output<Schema>; visitor: Visitor }) => Promise<{ data: Output; audit: AuditDetails }>;
}) {
  return async (rawInput: unknown, visitor: Visitor): Promise<PublicActionResult<Output>> => {
    // The hashed visitor, never the address, is what the audit log keeps for a public call.
    const request = { ipAddress: visitor.ipHash, userAgent: visitor.userAgent };
    const anonymous = { userId: null, personId: null, email: null };

    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      // Field-level codes stay on the server: a public form is told *that* it was wrong, and its
      // own client-side validation says where. Telling a stranger which of fifteen fields a probe
      // tripped is a map of the schema.
      await recordAudit({ action: `${definition.name}.invalid`, actor: anonymous, request, summary: parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).slice(0, 10).join(" ") });
      return { ok: false, error: "invalid" };
    }

    const limit = await definition.rateLimit({ visitor });
    if (!limit.ok) {
      await recordAudit({ action: `${definition.name}.rate_limited`, actor: anonymous, request, after: { retryAfterSeconds: limit.retryAfterSeconds } });
      return { ok: false, error: "rate_limited", message: "rate_limited" };
    }

    const spam = definition.spamCheck(parsed.data, { visitor });
    if (spam.verdict === "drop") {
      await recordAudit({ action: `${definition.name}.dropped`, actor: anonymous, request, summary: spam.reason });
      return { ok: true, data: definition.dropped() };
    }
    if (spam.verdict === "refuse") {
      await recordAudit({ action: `${definition.name}.refused`, actor: anonymous, request, summary: spam.reason });
      return { ok: false, error: "rejected", message: spam.reason };
    }

    try {
      const { data, audit } = await definition.run({ input: parsed.data, visitor });
      await recordAudit({ ...audit, action: definition.name, actor: anonymous, request });
      return { ok: true, data };
    } catch (error) {
      // An `ActionError` is an *expected* refusal whose message is a key the page looks up ("this
      // job has closed"), so it is passed on — the alternative is telling an applicant to try
      // again at something that will never work. Its `details` are **dropped**: inside the app
      // that field carries things like the candidate records a submission looked like, which is
      // precisely what must not cross this boundary.
      if (error instanceof ActionError) {
        await recordAudit({ action: `${definition.name}.refused`, actor: anonymous, request, summary: error.message });
        return { ok: false, error: "failed", message: error.message };
      }
      // Anything else is a bug or an outage. A stack trace never reaches a stranger, and neither
      // does the message: the server log gets it, the caller gets a word.
      console.error(JSON.stringify({ level: "error", event: `${definition.name}.failed`, message: error instanceof Error ? error.message : String(error) }));
      await recordAudit({ action: `${definition.name}.failed`, actor: anonymous, request });
      return { ok: false, error: "failed", message: "failed" };
    }
  };
}
