import { SegmentMessages } from "@/i18n/segment-messages";

// Payslips are compensation tier whoever is reading them — including the person's own (SRS §2.2,
// NFR-SEC-08). Rendered per request, never cached, and every page asks for a recent
// re-authentication (FR-PLT-06).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function PayslipsLayout({ children }: LayoutProps<"/payslips">) {
  return <SegmentMessages segment="payslips">{children}</SegmentMessages>;
}
