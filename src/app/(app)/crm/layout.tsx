import { SegmentMessages } from "@/i18n/segment-messages";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function CrmLayout({ children }: LayoutProps<"/crm">) {
  return <SegmentMessages segment="crm">{children}</SegmentMessages>;
}
