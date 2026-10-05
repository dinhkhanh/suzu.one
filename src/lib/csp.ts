// The Content-Security-Policy every page is served with (NFR-SEC-01). Pure: the proxy
// (`src/proxy.ts`) hands in a fresh nonce and what the configuration says, and writes the answer
// onto the request — where Next reads the nonce off it and puts it on its own scripts — and onto
// the response.
//
// **Report-only until somebody has watched it.** `CSP_MODE` is `report-only` by default: the
// browser is sent the policy as `Content-Security-Policy-Report-Only`, blocks nothing, and reports
// what it would have blocked. `enforce` sends the very same policy as the enforcing header, and
// `off` sends neither. One policy, one switch — what was watched is what gets enforced.
//
// The policy is an inventory of what the app's pages really load, each source named for what
// needs it. Adding a third party to a page means adding it here, with the reason.

import { APP_SURFACE } from "@/i18n/surfaces";
import { EMBED_FRAME_ORIGINS } from "@/modules/platform/rich-text/engine/embed";

export const CSP_MODES = ["report-only", "enforce", "off"] as const;
export type CspMode = (typeof CSP_MODES)[number];

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

export type CspInput = {
  /** One per request, unguessable: Next puts it on every script it writes into the page. */
  nonce: string;
  /** The surface the proxy read off the path (`src/i18n/surfaces.ts`). */
  surface: string;
  /** A developer's own machine, where React needs `eval` for its error overlay. */
  development: boolean;
  /** The file bucket's origin (`r2Endpoint`): signed links to pictures, video and downloads, and the browser's own uploads. */
  storageOrigin: string | null;
  /** Where the browser's Sentry SDK sends errors, and where violation reports go; null without a DSN. */
  sentry: SentryCsp | null;
};

/**
 * The surfaces whose pages run the face engine — MediaPipe and ONNX Runtime, both WebAssembly
 * (`attendance/ui/kiosk/face-engine.ts`): the kiosk on the wall, and the internal app, where HR
 * enrols faces under Attendance → Face kiosk. The app as a whole and not that one page, because a
 * policy belongs to the document that was loaded: somebody who opened the app on their home page
 * and walked to the enrolment screen is still under the home page's policy. The public surfaces
 * — careers, review links, brand pages, the site, sign-in — never compile WebAssembly.
 */
const FACE_ENGINE_SURFACES: readonly string[] = [APP_SURFACE, "kiosk"];

/**
 * The policy as directives, in the order they are sent. `enforcing` adds
 * `upgrade-insecure-requests`, which a report-only policy may not carry.
 */
export function cspDirectives(input: CspInput, enforcing: boolean): [directive: string, sources: string[]][] {
  const { nonce, storageOrigin, sentry } = input;
  const faceEngine = FACE_ENGINE_SURFACES.includes(input.surface);
  const storage = storageOrigin ? [storageOrigin] : [];
  const directives: [string, string[]][] = [
    // Anything not named below comes from this origin or not at all.
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        // An older browser, which does not know 'strict-dynamic', falls back to this origin's files.
        "'self'",
        // Next's own inline scripts and bundles carry the nonce; no 'unsafe-inline'.
        `'nonce-${nonce}'`,
        // What a trusted script loads is trusted: the chunks Next adds as the reader moves about,
        // Vercel Analytics and Speed Insights (/_vercel/…/script.js), the kiosk's runtime loaders.
        "'strict-dynamic'",
        // Compiling WebAssembly, and nothing else `eval` would allow.
        ...(faceEngine ? ["'wasm-unsafe-eval'"] : []),
        ...(input.development ? ["'unsafe-eval'"] : []),
      ],
    ],
    // The UI libraries position and animate with inline styles (Base UI, Floating UI, the editor,
    // the player), and React's `style` prop is one: a nonce here would switch all of them off.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Pictures: this origin's, the browser's own (camera stills, pasted images, QR codes), and any
    // https address — a rich-text note may show a picture from wherever its author found it, a
    // Google profile picture and a signed storage link among them. Scripts cannot ride an <img>.
    ["img-src", ["'self'", "data:", "blob:", "https:", ...storage.filter((origin) => !origin.startsWith("https:"))]],
    // next/font serves the two families from this origin.
    ["font-src", ["'self'"]],
    // fetch/XHR: server actions and the API here, Vercel's analytics endpoints (same origin), the
    // bucket (uploads PUT straight to it; previews read bytes from it), and Sentry's ingest.
    ["connect-src", ["'self'", ...storage, ...(sentry ? [sentry.ingestOrigin] : [])]],
    // Video and audio play from a signed storage link.
    ["media-src", ["'self'", "blob:", ...storage]],
    // A PDF preview is a blob in the browser's own viewer; the rest are the embeds a note may
    // carry — the editor's allow-list, nothing more. (A .docx preview is a sandboxed `srcdoc`.)
    ["frame-src", ["blob:", ...Object.values(EMBED_FRAME_ORIGINS)]],
    // The service worker (/sw.js); the face engine's runtimes may start theirs from a blob.
    ["worker-src", ["'self'", ...(faceEngine ? ["blob:"] : [])]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Every form posts to this origin. (Signing in with Google is a navigation, not a form.)
    ["form-action", ["'self'"]],
    // Nothing frames the app. No page here is framed by another of ours either: the document
    // preview is a `srcdoc` frame, which has no response and so no ancestors to check.
    ["frame-ancestors", ["'none'"]],
  ];
  if (enforcing && !input.development) directives.push(["upgrade-insecure-requests", []]);
  if (sentry) directives.push(["report-uri", [sentry.reportUri]]);
  return directives;
}

/** The header to send — its name says whether the browser enforces it — or null when the policy is off. */
export function contentSecurityPolicy(mode: CspMode, input: CspInput): { name: string; value: string } | null {
  if (mode === "off") return null;
  const enforcing = mode === "enforce";
  const value = cspDirectives(input, enforcing)
    .map(([directive, sources]) => [directive, ...sources].join(" "))
    .join("; ");
  return { name: enforcing ? CSP_HEADER : CSP_REPORT_ONLY_HEADER, value };
}

/** A nonce for one request: 122 random bits, in the characters a header and an attribute both take. */
export const newNonce = (): string => Buffer.from(crypto.randomUUID()).toString("base64");

/** The origin of a configured URL, or null when there is none or it is not one. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export type SentryCsp = { ingestOrigin: string; reportUri: string };

/**
 * What the policy needs from Sentry, read off the DSN the SDK already has
 * (`https://<public key>@<host>/<project>`): the host the browser SDK posts to, and the project's
 * security endpoint, which takes violation reports. Nothing new is configured and nothing secret
 * is used — the DSN's key is public by design, it ships in the browser bundle. Null for no DSN,
 * or one that does not parse: then nothing is reported and the SDK's host is not allowed.
 */
export function sentryCsp(dsn: string | null | undefined): SentryCsp | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const segments = url.pathname.split("/").filter(Boolean);
    const project = segments.pop();
    if (url.protocol !== "https:" || !url.username || !project || !/^\d+$/.test(project)) return null;
    const base = `${url.origin}${segments.map((segment) => `/${segment}`).join("")}`;
    return { ingestOrigin: url.origin, reportUri: `${base}/api/${project}/security/?sentry_key=${encodeURIComponent(url.username)}` };
  } catch {
    return null;
  }
}
