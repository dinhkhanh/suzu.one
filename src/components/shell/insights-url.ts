/**
 * The URL Vercel Web Analytics and Speed Insights may see. Some paths carry the credential itself
 * — the client's review link (D24), a candidate's assignment link, a one-tap approval, an asset's
 * QR code — and a query string can carry a search term with a person's name in it. Neither belongs
 * in a third party's dashboard, so the token segment becomes `[token]` and the query and fragment
 * are dropped.
 */
const TOKEN_ROUTES = ["/preview/", "/careers/assignment/", "/approvals/act/", "/assets/qr/"];

export function insightsUrl(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname;
  for (const prefix of TOKEN_ROUTES) {
    if (path.startsWith(prefix)) {
      path = prefix + "[token]" + path.slice(prefix.length).replace(/^[^/]*/, "");
      break;
    }
  }
  return parsed.origin + path;
}
