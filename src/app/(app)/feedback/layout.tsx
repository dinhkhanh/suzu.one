import { SegmentMessages } from "@/i18n/segment-messages";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function FeedbackLayout({ children }: LayoutProps<"/feedback">) {
  return <SegmentMessages segment="feedback">{children}</SegmentMessages>;
}
