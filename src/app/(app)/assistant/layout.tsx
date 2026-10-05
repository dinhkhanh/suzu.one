import { SegmentMessages } from "@/i18n/segment-messages";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function AssistantLayout({ children }: LayoutProps<"/assistant">) {
  return <SegmentMessages segment="assistant">{children}</SegmentMessages>;
}
