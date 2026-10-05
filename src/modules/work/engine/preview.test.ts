// Golden tests for the client review link's pure half (D24, FR-PJM-51a): the token, the states a
// link passes through, the limiter's arithmetic, and who a request is from — a person, or a
// machine fetching on a person's behalf (R14).
import { describe, expect, it } from "vitest";
import {
  hashPreviewToken,
  isPreviewFetcher,
  isPreviewTokenShaped,
  linkIsOpen,
  linkState,
  newPreviewToken,
  PREVIEW_DECISIONS,
  PREVIEW_LIMITS,
  PREVIEW_MAX_DAYS,
  previewCommentRequired,
  previewExpiresAt,
  previewRequestKind,
  previewTokenMatches,
  previewViewAuditKey,
  retryAfterSeconds,
  windowStartFor,
  withinLimit,
} from "./preview";

const at = (iso: string) => new Date(iso);
const facts = (over: Partial<Parameters<typeof linkState>[0]> = {}) => ({ expiresAt: at("2026-10-01T00:00:00Z"), revokedAt: null, decidedAt: null, viewCount: 0, ...over });

describe("the token", () => {
  it("is 32 random bytes, base64url, and never the same twice", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newPreviewToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 bytes in base64url, unpadded.
      expect(token).toHaveLength(43);
      expect(isPreviewTokenShaped(token)).toBe(true);
    }
  });

  it("is stored as SHA-256 of itself and matches only itself", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(previewTokenMatches(hash, token)).toBe(true);
    expect(previewTokenMatches(hash, newPreviewToken())).toBe(false);
  });

  it("refuses anything that is not shaped like one, before it is hashed or compared", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    for (const wrong of ["", "short", `${token}!`, `${token} `, "a".repeat(201), "../../etc/passwd", "%2e%2e"]) {
      expect(isPreviewTokenShaped(wrong)).toBe(false);
      expect(previewTokenMatches(hash, wrong)).toBe(false);
    }
  });

  it("compares a near-miss without ever returning true", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    // One character different, and the same length: the case a non-constant-time compare leaks.
    const near = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(near).toHaveLength(token.length);
    expect(previewTokenMatches(hash, near)).toBe(false);
    // A hash of the wrong length is refused rather than throwing.
    expect(previewTokenMatches(hash.slice(0, 40), token)).toBe(false);
  });
});

describe("how long a link lives", () => {
  it("counts whole days forward and clamps what it is given", () => {
    const from = at("2026-09-23T10:00:00Z");
    expect(previewExpiresAt(from, 14).toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(previewExpiresAt(from, 1).toISOString()).toBe("2026-09-24T10:00:00.000Z");
    // Nobody makes a link that outlives the project, and nobody makes one that has already expired.
    expect(previewExpiresAt(from, 1000).toISOString()).toBe(previewExpiresAt(from, PREVIEW_MAX_DAYS).toISOString());
    expect(previewExpiresAt(from, 0).toISOString()).toBe(previewExpiresAt(from, 1).toISOString());
    expect(previewExpiresAt(from, -5).toISOString()).toBe(previewExpiresAt(from, 1).toISOString());
  });
});

describe("the state of a link", () => {
  const now = at("2026-09-24T00:00:00Z");

  it("is active until somebody opens it, and viewed after", () => {
    expect(linkState(facts(), now)).toBe("active");
    expect(linkState(facts({ viewCount: 3 }), now)).toBe("viewed");
    expect(linkIsOpen(facts({ viewCount: 3 }), now)).toBe(true);
  });

  it("expires on the second it says it does", () => {
    const expiring = facts({ expiresAt: now });
    expect(linkState(expiring, now)).toBe("expired");
    expect(linkState(expiring, new Date(now.getTime() - 1))).toBe("active");
    expect(linkIsOpen(expiring, now)).toBe(false);
  });

  it("is revoked whatever else is true of it, and decided before it is expired", () => {
    expect(linkState(facts({ revokedAt: now, decidedAt: now, viewCount: 9 }), now)).toBe("revoked");
    // A link that took its decision and then ran out is still the link that was answered.
    expect(linkState(facts({ decidedAt: at("2026-09-23T00:00:00Z"), expiresAt: at("2026-09-23T12:00:00Z") }), now)).toBe("decided");
    expect(linkIsOpen(facts({ decidedAt: now }), now)).toBe(false);
    expect(linkIsOpen(facts({ revokedAt: now }), now)).toBe(false);
  });
});

describe("what the client may say", () => {
  it("asks for a comment on anything but a plain approval", () => {
    expect(PREVIEW_DECISIONS).toEqual(["approved", "approved_with_changes", "changes_required"]);
    expect(previewCommentRequired("approved")).toBe(false);
    expect(previewCommentRequired("approved_with_changes")).toBe(true);
    expect(previewCommentRequired("changes_required")).toBe(true);
  });
});

describe("the rate limiter's arithmetic", () => {
  it("aligns every window to the same grid", () => {
    expect(windowStartFor(at("2026-09-23T10:37:41Z"), 3600).toISOString()).toBe("2026-09-23T10:00:00.000Z");
    expect(windowStartFor(at("2026-09-23T10:00:00Z"), 3600).toISOString()).toBe("2026-09-23T10:00:00.000Z");
  });

  it("allows exactly the limit and refuses the one after it", () => {
    const limit = PREVIEW_LIMITS.decide;
    expect(withinLimit(limit.max, limit)).toBe(true);
    expect(withinLimit(limit.max + 1, limit)).toBe(false);
  });

  it("asks a refused caller to wait until the window ends", () => {
    expect(retryAfterSeconds(at("2026-09-23T10:59:30Z"), 3600)).toBe(30);
    // Never zero: "try again in no time at all" is an invitation to a loop.
    expect(retryAfterSeconds(at("2026-09-23T10:59:59.999Z"), 3600)).toBe(1);
  });
});

describe("the once-an-hour audit marker", () => {
  it("is within its limit exactly once a window", () => {
    expect(withinLimit(1, PREVIEW_LIMITS.view_audit)).toBe(true);
    expect(withinLimit(2, PREVIEW_LIMITS.view_audit)).toBe(false);
    expect(PREVIEW_LIMITS.view_audit.windowSeconds).toBe(60 * 60);
  });

  it("is keyed by one visitor on one link, and says neither", () => {
    const [link, other] = [hashPreviewToken(newPreviewToken()), hashPreviewToken(newPreviewToken())];
    const key = previewViewAuditKey(link, "visitor-a");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(previewViewAuditKey(link, "visitor-a")).toBe(key);
    expect(previewViewAuditKey(link, "visitor-b")).not.toBe(key);
    expect(previewViewAuditKey(other, "visitor-a")).not.toBe(key);
    // A hash of the two, so the counter's table still names neither the link nor the visitor.
    expect(key).not.toContain("visitor-a");
    expect(key).not.toBe(link.slice(0, 32));
  });
});

describe("who is asking: a person, or a machine on a person's behalf (R14)", () => {
  /** What a client's own browser says it is — at a desk, on a phone, and inside the chat app the link arrived in. */
  const PEOPLE = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    // Zalo's in-app browser on a phone names Zalo, and is exactly who the page is for.
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/531 ZaloTheme/light ZaloLanguage/vn",
    "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Zalo android/12100772 ZaloTheme/light ZaloLanguage/vi",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;FBDV/iPhone15,2]",
    // A make of phone, not a bot.
    "Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    // What an iPhone fetches a video with: the page's own player must be let through.
    "AppleCoreMedia/1.0.0.21F90 (iPhone; U; CPU OS 17_5 like Mac OS X; en_us)",
  ];
  /** What fetches a link the moment it is pasted into a chat, and what crawls. */
  const MACHINES = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    // iMessage, which says it is two other things.
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
    // Zalo anywhere but in a phone's browser — its servers, the desktop app — is drawing a card.
    // (Zalo publishes no user agent for its fetcher; this is the shape the rule is written for.)
    "Mozilla/5.0 (compatible; Zalo/1.0; +https://zalo.me)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ZaloPC-win32-24v712/24.7.12 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0 A",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
    "SomeNewCrawler/3.1",
    "curl/8.6.0",
    "",
  ];

  it("tells a link-preview fetcher and a crawler from a browser, by user agent", () => {
    for (const agent of PEOPLE) expect(isPreviewFetcher(agent), agent).toBe(false);
    for (const agent of MACHINES) expect(isPreviewFetcher(agent), agent).toBe(true);
    // No user agent at all is not a browser.
    expect(isPreviewFetcher(null)).toBe(true);
  });

  it("sorts a HEAD and a fetch-ahead out before the user agent is looked at", () => {
    const [browser] = PEOPLE;
    expect(previewRequestKind({ method: "GET", userAgent: browser })).toBe("view");
    expect(previewRequestKind({ method: "HEAD", userAgent: browser })).toBe("probe");
    for (const purpose of ["prefetch", "prefetch;prerender", "Prefetch"]) expect(previewRequestKind({ method: "GET", userAgent: browser, purpose }), purpose).toBe("prefetch");
    // The client's answer is a POST, and no header on it makes it anything else.
    expect(previewRequestKind({ method: "POST", userAgent: browser, purpose: "prefetch" })).toBe("view");
    expect(previewRequestKind({ method: "GET", userAgent: MACHINES[0] })).toBe("fetcher");
  });
});
