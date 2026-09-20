import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { TreeNode } from "../pages";

/** The pages of a space as an indented list. `tree` is already what the viewer may see, in reading order. */
export async function PageTree({ tree, currentId, compact = false }: { tree: TreeNode[]; currentId?: string; compact?: boolean }) {
  const t = await getTranslations("kb");
  if (tree.length === 0) return <p className="text-sm text-muted-foreground">{t("space.empty")}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <li key={node.id} style={{ paddingLeft: `${node.depth * (compact ? 0.75 : 1.25)}rem` }} className="flex items-center gap-2">
          <Link href={`/kb/pages/${node.id}`} aria-current={node.id === currentId ? "page" : undefined} className={`min-w-0 truncate rounded px-1.5 py-1 text-sm hover:bg-muted ${node.id === currentId ? "bg-muted font-medium" : ""} ${node.status === "archived" ? "text-muted-foreground line-through" : ""}`}>
            {node.title}
          </Link>
          {node.restricted ? <span title={t("page.restricted")} aria-label={t("page.restricted")}>🔒</span> : null}
          {compact ? null : !node.published ? <Badge variant="outline">{t(`status.${node.status}`)}</Badge> : node.hasUnpublishedChanges ? <Badge variant="outline">{t("page.unpublishedChanges")}</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
