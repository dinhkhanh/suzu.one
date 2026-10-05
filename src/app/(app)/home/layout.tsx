import { SegmentMessages } from "@/i18n/segment-messages";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function HomeLayout({ children }: LayoutProps<"/home">) {
  return <SegmentMessages segment="home">{children}</SegmentMessages>;
}
