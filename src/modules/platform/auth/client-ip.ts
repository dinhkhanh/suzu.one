// The address a request came from, as far as it can be trusted.
//
// `X-Forwarded-For` is a list every hop appends to, and its *first* entry is whatever the client
// chose to send — so it is only trustworthy where the platform overwrites the header. Vercel does
// (it replaces `x-forwarded-for` and sets `x-real-ip` to the connecting address); a plain reverse
// proxy appends. Reading `x-real-ip` first and otherwise the *last* forwarded entry (the one the
// nearest proxy added) is right in both set-ups and never takes the client's word for it. Behind
// more than one proxy of your own, set `x-real-ip` at the outermost one.
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? null;
}
