import { SegmentMessages } from "@/i18n/segment-messages";

// Every payroll screen is compensation tier: rendered per request, never cached (NFR-SEC-08).
// Each page checks its own permission, then asks for a recent re-authentication (FR-PLT-06).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function PayrollLayout({ children }: LayoutProps<"/payroll">) {
  return <SegmentMessages segment="payroll">{children}</SegmentMessages>;
}
