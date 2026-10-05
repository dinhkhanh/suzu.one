import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { MessagesScope } from "./messages-scope";
import { type AppSegment, SEGMENT_NAMESPACES } from "./route-namespaces.generated";
import { pickMessages } from "./surfaces";

/**
 * The words one section of the app (`(app)/<segment>/layout.tsx`) hands its client components, on
 * top of the shell's (the root layout). Which namespaces those are is read off the code
 * (`scripts/i18n-route-namespaces.ts`). Picked from what this request may have at all, so a request
 * with nobody signed in still gets no more than the public words (`src/i18n/request.ts`).
 */
export async function SegmentMessages({ segment, children }: { segment: AppSegment; children: ReactNode }) {
  const namespaces: readonly string[] = SEGMENT_NAMESPACES[segment];
  if (namespaces.length === 0) return children;
  return <MessagesScope messages={pickMessages((await getMessages()) as Record<string, unknown>, namespaces)}>{children}</MessagesScope>;
}
