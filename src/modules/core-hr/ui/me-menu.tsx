import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { NavIcon } from "@/components/shell/nav-icons";
import { List, ListItem } from "@/components/ui/list";
import { cn } from "@/lib/utils";

// The Me page's menu: a row per place that is the person's own (attendance, leave, requests…),
// each with the navigation's icon on a small tinted tile, the name, a figure at the right end
// and a chevron. Server component; the rows are links, so the whole row is the target.

export type MenuRow = { key: string; href: string; label: string; meta?: ReactNode; icon?: string };

/** The 30px tinted tile an icon sits on, in the menu and in the small lists. */
export function IconTile({ name, className, children }: { name?: string; className?: string; children?: ReactNode }) {
  return <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary/8 text-primary [&_svg]:size-4", className)}>{children ?? (name ? <NavIcon name={name} /> : null)}</span>;
}

export function MenuList({ rows, className }: { rows: MenuRow[]; className?: string }) {
  return (
    <List className={className}>
      {rows.map((row) => (
        <ListItem key={row.key} href={row.href} className="press">
          <IconTile name={row.icon ?? row.key} />
          <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
          {row.meta ? <span className="shrink-0 text-[0.8125rem] text-faint tabular-nums">{row.meta}</span> : null}
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </ListItem>
      ))}
    </List>
  );
}
