import type { StatusColour } from "../enums";

const CLASSES: Record<StatusColour, string> = {
  upcoming: "border text-muted-foreground",
  due_soon: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  overdue: "bg-destructive/10 text-destructive",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  done_late: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

/** The status colours of FR-OPS-07. The label is passed in so this works in server and client components alike. */
export function StatusBadge({ colour, label }: { colour: StatusColour; label: string }) {
  return <span className={`inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap ${CLASSES[colour]}`}>{label}</span>;
}
