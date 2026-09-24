import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { StatusColour } from "../enums";

// The status colours of FR-OPS-07, in the app's tones: `done_late` is the one word that needs a
// colour of its own, between green and red.
const TONE: Record<StatusColour, BadgeVariant> = {
  upcoming: "outline",
  due_soon: "warning",
  overdue: "destructive",
  done: "success",
  done_late: "orange",
  cancelled: "outline",
};

/** The label is passed in so this works in server and client components alike. */
export function StatusBadge({ colour, label }: { colour: StatusColour; label: string }) {
  return (
    <Badge dot variant={TONE[colour]} className={colour === "cancelled" ? "line-through" : undefined}>
      {label}
    </Badge>
  );
}
