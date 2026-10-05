// The link in a candidate's letters to their own privacy page (FR-REC-04, 13; NFR-PRV-01, 03):
// "are you keeping me, and stop keeping me". Pure: the secret is an argument.
//
// Three properties, each for a reason:
//   · **No identifier in the URL.** The token is an HMAC of the record's id and its address; the
//     id itself never crosses the boundary, as on the rest of the careers surface.
//   · **The same link in every letter.** Derived, not random, so the acknowledgement and the
//     rejection months later carry one link, and neither stops the other working.
//   · **Bound to the address.** The address is part of what is signed: when a recruiter corrects a
//     candidate's address, the link that went to the old one stops opening anything.
//
// The database keeps only the token's SHA-256 (`candidate.privacy_token_hash`), which is how the
// page finds the record without the token carrying its id — and why reading the table is not a
// way to open anybody's page.
import { createHash, createHmac } from "node:crypto";

/** The token for one record and the address its letters go to. */
export function privacyToken(secret: string, candidate: { id: string; emailKey: string }): string {
  return createHmac("sha256", secret).update(`candidate-privacy:${candidate.id}:${candidate.emailKey}`).digest("base64url");
}

/** What is stored and looked up. Hex, so it never needs escaping anywhere. */
export function privacyTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A string that could be a token at all. Anything else is refused before the database is asked. */
export const looksLikePrivacyToken = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);
