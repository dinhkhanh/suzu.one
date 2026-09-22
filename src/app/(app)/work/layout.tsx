import { HandoffNoteDraftProvider } from "./handoff-note-draft";

/** Every work screen that can open a hand-off sheet offers to draft its note (FR-PJM-64). */
export default function WorkLayout({ children }: LayoutProps<"/work">) {
  return <HandoffNoteDraftProvider>{children}</HandoffNoteDraftProvider>;
}
