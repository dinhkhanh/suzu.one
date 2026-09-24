"use client";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { insightsUrl } from "./insights-url";

/** Vercel Web Analytics and Speed Insights, sent only URLs with no credential or query in them. */
export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: insightsUrl(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: insightsUrl(event.url) })} />
    </>
  );
}
