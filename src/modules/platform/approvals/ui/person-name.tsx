import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RecordLink } from "@/components/ui/record-link";
import { cn } from "cn";

/** "Lê Thị Mai" → "LM": the first letter of the first and the last word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** A person in a cell of the grid: a small initials disc and the name — the way to their profile, given the id. */
export function PersonName({ name, personId, className }: { name: string; personId?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar size="sm">
        <AvatarFallback className="text-[0.625rem] font-medium">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <RecordLink kind="person" id={personId} className="truncate">
        {name}
      </RecordLink>
    </span>
  );
}
