import { SegmentMessages } from "@/i18n/segment-messages";
import { HandoffNoteDraftProvider } from "./handoff-note-draft";

/**
 * Every work screen that can open a hand-off sheet offers to draft its note (FR-PJM-64). The words
 * this section's client components use come on top of the shell's (PERF-01).
 */
export default function WorkLayout({ children }: LayoutProps<"/work">) {
  return (
    <SegmentMessages segment="work">
      <HandoffNoteDraftProvider>{children}</HandoffNoteDraftProvider>
    </SegmentMessages>
  );
}
