import { useFormatter } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "cn";
import { initialsOf } from "@/lib/text";

// The anatomy of a task row, shared by every task list (My tasks, a project's list,
// the board, a team's backlog): the state dot, the key in mono, the project chip with its colour
// square, the due date that turns warning today and destructive when overdue, and the assignee's
// avatar. One place, so the rows read the same wherever they appear.

/** The broad state a dot can show; a workflow state's category or a task's status maps onto it. */
export type DotCategory = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";

/** From a task's status (and, when known, its review status) to the dot's category. */
export function dotOf(status: string, reviewStatus?: string | null): DotCategory {
  if (status === "done") return "done";
  if (status === "cancelled") return "cancelled";
  if (reviewStatus === "pending" || reviewStatus === "submitted" || reviewStatus === "in_review") return "in_review";
  return status === "in_progress" ? "in_progress" : "todo";
}

const DOT: Record<DotCategory, string> = {
  backlog: "border-2 border-dashed border-faint/70 bg-transparent",
  todo: "border-2 border-faint/70 bg-transparent",
  in_progress: "bg-primary",
  in_review: "bg-tone-violet",
  done: "bg-success",
  cancelled: "bg-faint/40",
};

/** A 9px disc coloured by the task's state category: in progress blue, in review violet, done green, to do an outline ring. */
export function StateDot({ category, title, className }: { category: DotCategory | string; title?: string; className?: string }) {
  const known = (category in DOT ? category : "todo") as DotCategory;
  return <span aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title} title={title} className={cn("inline-block size-[9px] shrink-0 rounded-full", DOT[known], className)} />;
}

/** Tailwind fills for the work accent colours (`ACCENT_COLORS`), for the 7px square on a project chip. */
export const ACCENT_SQUARE: Record<string, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
};

/** A small square in a project's or team's colour; a faint one when it has none. */
export function ColorSquare({ color, className }: { color?: string | null; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-[2px]", (color && ACCENT_SQUARE[color]) || "bg-faint/40", className)} />;
}

/** The project chip of a row: a muted pill with the colour square and the name, cut short when long. */
export function ProjectChip({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-muted-foreground", className)} title={name}>
      <ColorSquare color={color} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Warning when due today, destructive when overdue — only while the task is open. */
export function dueTone(dueDate: string | null | undefined, today: string, open: boolean): "overdue" | "today" | "plain" | "none" {
  if (!dueDate) return "none";
  if (!open) return "plain";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "plain";
}

/** The due date of a row, short, in the tone the deadline earns. */
export function DueText({ dueDate, today, open, className, long = false }: { dueDate: string | null | undefined; today: string; open: boolean; className?: string; long?: boolean }) {
  const format = useFormatter();
  const tone = dueTone(dueDate, today, open);
  if (tone === "none") return <span className={cn("text-faint", className)}>—</span>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", tone === "overdue" && "font-medium text-destructive", tone === "today" && "font-medium text-warning", tone === "plain" && "text-muted-foreground", className)}>
      {format.dateTime(new Date(`${dueDate}T00:00:00`), long ? { dateStyle: "medium" } : { day: "numeric", month: "short" })}
    </span>
  );
}

/** A person as a small round of initials, the full name on hover. */
export function PersonAvatar({ name, className, size = "sm" }: { name: string | null | undefined; className?: string; size?: "sm" | "default" }) {
  if (!name) return <span aria-hidden className={cn("inline-block size-6 shrink-0 rounded-full border border-dashed border-faint/60", className)} />;
  return (
    <Avatar size={size} title={name} className={className}>
      <AvatarFallback className="bg-muted text-[0.625rem] font-medium text-muted-foreground uppercase">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

/** The key of a task, in mono and faint, as every row prints it. */
export function TaskKey({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("shrink-0 font-mono text-xs text-faint tabular-nums", className)}>{children}</span>;
}
