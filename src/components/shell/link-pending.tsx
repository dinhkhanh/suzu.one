"use client";
import { useLinkStatus } from "next/link";

/**
 * Put inside a `<Link>`: marks it `data-link-pending` while its page is on the way, so a tapped tab
 * stop or sidebar row takes the highlight at once — the way a native tab bar answers the finger —
 * instead of when the server has answered (globals.css styles it). Renders nothing visible.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span hidden data-link-pending={pending ? "" : undefined} />;
}
