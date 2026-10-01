// The knowledge base's two panes: the spaces down the left (248px on a desk) with the open space's
// page tree unfolded under it, and whatever is being read on the right. On a phone the tree folds
// into a row of chips over the page, which then reads full width.
import { BookOpenIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { TreeNode } from "../pages";
import type { SpaceListRow } from "../spaces";
import { PageTree } from "./page-tree";

export type ShellSpace = Pick<SpaceListRow, "id" | "key" | "name" | "icon" | "pageCount" | "archivedAt">;

export async function KbShell({
  spaces,
  currentSpaceKey,
  tree,
  currentPageId,
  children,
}: {
  spaces: ShellSpace[];
  currentSpaceKey?: string;
  /** The open space's pages, when one is open. */
  tree?: TreeNode[];
  currentPageId?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("kb");
  const shown = spaces.filter((space) => !space.archivedAt || space.key === currentSpaceKey);
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
      {/* The phone: the spaces as a row of tabs. */}
      <nav className="tab-row -mx-4 px-4 lg:hidden" aria-label={t("shell.spaces")}>
        <Link href="/kb" aria-current={!currentSpaceKey ? "page" : undefined}>
          {t("title")}
        </Link>
        {shown.map((space) => (
          <Link key={space.id} href={`/kb/spaces/${space.key}`} aria-current={space.key === currentSpaceKey ? "page" : undefined}>
            {space.name}
            <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{space.pageCount}</span>
          </Link>
        ))}
      </nav>

      {/* The desk: the tree. */}
      <aside className="hidden min-w-0 self-start lg:sticky lg:top-0 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        <nav aria-label={t("shell.spaces")} className="flex flex-col gap-px">
          <p className="section-label px-2 pb-1.5">{t("shell.spaces")}</p>
          {shown.map((space) => {
            const on = space.key === currentSpaceKey;
            return (
              <div key={space.id} className="flex flex-col gap-px">
                <Link
                  href={`/kb/spaces/${space.key}`}
                  aria-current={on ? "page" : undefined}
                  className={cn("flex h-[30px] min-w-0 items-center gap-2 rounded-[7px] px-2 text-[0.8125rem] font-medium transition-colors duration-100", on ? "bg-primary/8 text-primary" : "text-foreground hover:bg-canvas")}
                >
                  <SpaceIcon icon={space.icon} className={on ? "text-primary" : "text-muted-foreground"} />
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{space.pageCount}</span>
                </Link>
                {on && tree ? <PageTree tree={tree} spaceKey={space.key} currentId={currentPageId} compact className="mb-1 ml-3 border-l border-border/70 pl-1.5" /> : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A space's own glyph (the one its manager chose), or the book. */
export function SpaceIcon({ icon, className }: { icon: string | null; className?: string }) {
  if (icon) {
    return (
      <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center text-[0.9375rem] leading-none", className)}>
        {icon}
      </span>
    );
  }
  return <BookOpenIcon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
