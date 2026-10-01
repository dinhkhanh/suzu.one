import { ChevronDownIcon, LockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { pagePath } from "../enums";
import type { TreeNode } from "../pages";

/**
 * The pages of a space as a tree: 30px rows, a chevron on the ones that have children (the tree is
 * always open — it is a table of contents, not a file manager), the open page in the accent, a lock
 * on a page with its own audience. `tree` is already what the viewer may see, in reading order.
 * `compact` is the sidebar's version: no status badges, tighter indents.
 */
export async function PageTree({ tree, spaceKey, currentId, compact = false, className }: { tree: TreeNode[]; spaceKey: string; currentId?: string; compact?: boolean; className?: string }) {
  const t = await getTranslations("kb");
  if (tree.length === 0) return <p className={cn("px-2 py-1.5 text-sm text-muted-foreground", className)}>{t("space.empty")}</p>;
  const parents = new Set(tree.map((node) => node.parentId).filter(Boolean));
  return (
    <ul className={cn("flex flex-col gap-px", className)}>
      {tree.map((node) => {
        const on = node.id === currentId;
        return (
          <li key={node.id} style={{ paddingLeft: `${node.depth * (compact ? 0.875 : 1.25)}rem` }}>
            <Link
              href={pagePath(spaceKey, node)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-[30px] min-w-0 items-center gap-1.5 rounded-[7px] px-2 text-[0.8125rem] transition-colors duration-100",
                on ? "bg-primary/8 font-medium text-primary" : "text-foreground hover:bg-canvas",
                node.status === "archived" && "text-muted-foreground line-through"
              )}
            >
              <ChevronDownIcon aria-hidden className={cn("size-3.5 shrink-0", parents.has(node.id) ? (on ? "text-primary/70" : "text-faint") : "invisible")} />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              {node.restricted ? <LockIcon aria-label={t("page.restricted")} className="size-3.5 shrink-0 text-faint" /> : null}
              {compact ? null : !node.published ? <Badge variant="outline">{t(`status.${node.status}`)}</Badge> : node.hasUnpublishedChanges ? <Badge variant="outline">{t("page.unpublishedChanges")}</Badge> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
