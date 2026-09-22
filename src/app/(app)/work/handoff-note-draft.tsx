"use client";
// The work screens' hand-off note gets the assistant's drafting button (FR-PJM-64) from here: the
// route layer may join two modules' screens, a module may not.
import type { ReactNode } from "react";
import { HandoffNoteDraftButton } from "@/modules/ai/ui/draft-button";
import { type HandoffNoteDraft, HandoffNoteDraftContext } from "@/modules/work/ui/handoff";

const draft: HandoffNoteDraft = ({ taskId, targets }) => <HandoffNoteDraftButton taskId={taskId} targets={targets} />;

export function HandoffNoteDraftProvider({ children }: { children: ReactNode }) {
  return <HandoffNoteDraftContext value={draft}>{children}</HandoffNoteDraftContext>;
}
