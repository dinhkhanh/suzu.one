import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next logs every server-function call in development **with its arguments**, and payroll
  // actions take salary figures as arguments — a developer's terminal would hold people's pay in
  // its scrollback. Off (see docs/PAYROLL_SECURITY_REVIEW.md, finding 3).
  logging: { serverFunctions: false },
  // Spreadsheet imports arrive through a server action; everything else is far below the default.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // The payslip PDF embeds a font it reads from disk at runtime (FR-PAY-32). Tracing a
  // `readFileSync` is best-effort, so the file is named here and copied into the deployment.
  outputFileTracingIncludes: { "/payslips/[payslipId]/pdf": ["./src/modules/platform/pdf/fonts/*.ttf"], "/payroll/runs/[runId]/payments/cash-sheet": ["./src/modules/platform/pdf/fonts/*.ttf"], "/assets/labels": ["./src/modules/platform/pdf/fonts/*.ttf"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
      // suzu.one is an internal tool, not the brand (that is suzu.vn): nothing on it belongs in a
      // search engine but the careers page (FR-REC-03). Said as a header so it covers what has no
      // <meta> tag. `/careers` is left to its pages' own tags — the listing and the adverts are
      // indexable, the application forms and thank-you pages are not. `robots.txt` lets crawlers
      // in on purpose: one that is kept out never reads this.
      { source: "/:path((?!careers(?:/|$)).*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // The service worker: never cached (a fix must reach every phone at once), may control the
      // whole origin, and may load nothing but this origin's own files.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      { source: "/offline.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // The client's review link (D24, FR-PJM-51a): the URL **is** the credential, so no crawler
      // may keep it and no browser, proxy or CDN may keep the page it opens. The tags on the page
      // say the same thing; this says it to everything between us and the client.
      {
        source: "/preview/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      // The other links whose URL is a credential: a one-tap approval, a candidate's assignment, an
      // asset's QR code. No page opened from one — nor Vercel Analytics, which reports the
      // referrer — may learn the token.
      ...["/approvals/act/:path*", "/careers/assignment/:path*", "/assets/qr/:path*"].map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] })),
      // Compensation screens (NFR-SEC-08): never stored by a browser, a proxy or a CDN.
      ...["/payroll/:path*", "/payroll", "/payslips/:path*", "/payslips", "/step-up"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] })),
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
