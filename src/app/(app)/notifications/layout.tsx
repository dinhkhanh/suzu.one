import { SegmentMessages } from "@/i18n/segment-messages";

/** The words this section's client components use, on top of the shell's (PERF-01). */
export default function NotificationsLayout({ children }: LayoutProps<"/notifications">) {
  return <SegmentMessages segment="notifications">{children}</SegmentMessages>;
}
