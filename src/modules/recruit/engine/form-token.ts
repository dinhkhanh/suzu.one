// The signed token every public application form carries (FR-REC-03). Pure in the sense that
// matters: deterministic, no I/O, no clock and no configuration of its own — the secret and the
// current time are arguments, which is what makes the expiry and the too-fast rule testable.
//
// It does three jobs at once, and each is cheap:
//   · **timing** — the token says when the form was rendered, so a submission that arrives three
//     seconds later was not typed by a person;
//   · **binding** — the signature covers the opening's slug, so a token minted on one advertisement
//     cannot be spent on another (a script that fetches one form and replays it across every job);
//   · **expiry** — a token older than the window is refused, so harvested tokens go stale.
//
// It is **not** a CSRF token and does not pretend to be one: there is no session to protect. It is
// a cost imposed on automation.
import { createHmac, timingSafeEqual } from "node:crypto";

/** A person cannot read an advertisement and fill in a form in less than this. */
export const MIN_FILL_MS = 4_000;
/** After this the form is stale and the visitor reloads. Long enough to write a cover letter. */
export const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export type TokenVerdict = "ok" | "token_invalid" | "token_expired" | "token_too_fast";

const sign = (secret: string, material: string): string => createHmac("sha256", secret).update(material).digest("base64url");

/** `"<issuedAtMs>.<signature>"`. The time is in the clear on purpose — it is signed, not secret. */
export function signFormToken(secret: string, input: { slug: string; issuedAt: Date }): string {
  const issuedAtMs = input.issuedAt.getTime();
  return `${issuedAtMs}.${sign(secret, `${input.slug}:${issuedAtMs}`)}`;
}

function signatureMatches(expected: string, given: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Every failure mode is one of four words, and the caller turns them into the same neutral
 * message: a probe learns nothing from being told its signature was wrong rather than its clock.
 */
export function verifyFormToken(secret: string, token: string, expect: { slug: string; now: Date; minFillMs?: number; maxAgeMs?: number }): TokenVerdict {
  const dot = token.indexOf(".");
  if (dot <= 0) return "token_invalid";
  const issuedAtMs = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0 || signature === "") return "token_invalid";
  if (!signatureMatches(sign(secret, `${expect.slug}:${issuedAtMs}`), signature)) return "token_invalid";

  const age = expect.now.getTime() - issuedAtMs;
  // A token from the future is a tampered clock or a replay with a hand-made timestamp; the
  // signature cannot be forged, so this only happens with a legitimately minted token being held
  // — either way it is not a form somebody just filled in.
  if (age < 0) return "token_invalid";
  if (age > (expect.maxAgeMs ?? MAX_AGE_MS)) return "token_expired";
  if (age < (expect.minFillMs ?? MIN_FILL_MS)) return "token_too_fast";
  return "ok";
}
