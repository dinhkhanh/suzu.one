"use client";
import {
  Asterisk,
  ChevronDown,
  Menu,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { NavIcon } from "@/components/shell/nav-icons";
import { Badge } from "@/components/ui/badge";
import { openCommandPalette } from "@/components/shell/palette-bus";
import {
  readCollapsed,
  readCollapsedOnServer,
  subscribeCollapsed,
  writeCollapsed,
} from "@/components/shell/sidebar-store";
import { cn } from "@/lib/utils";

export type NavRow = {
  key: string;
  href?: string;
  label: string;
  count?: number;
};

export type FrameLabels = {
  workspace: string;
  quickActions: string;
  general: string;
  admin: string;
  menu: string;
  close: string;
  collapse: string;
  soon: string;
};

type Props = {
  labels: FrameLabels;
  pinned: NavRow[];
  main: NavRow[];
  admin: NavRow[];
  user: { name: string; email: string };
  footer: ReactNode;
  /** At the right end of the header on every page: the feedback button. */
  headerEnd?: ReactNode;
  children: ReactNode;
};

// A stored href is the crumb for every path below it, so /assets/bookings reads
// "Assets / Equipment bookings" and a person's page reads "People".
function crumbsFor(pathname: string, rows: NavRow[]): NavRow[] {
  const matches = rows.filter(
    (row) =>
      row.href &&
      (pathname === row.href || pathname.startsWith(`${row.href}/`)),
  );
  matches.sort((a, b) => (a.href?.length ?? 0) - (b.href?.length ?? 0));
  return matches.slice(-2);
}

function Row({
  row,
  collapsed,
  active,
  soonLabel,
}: {
  row: NavRow;
  collapsed: boolean;
  active: boolean;
  soonLabel: string;
}) {
  const body = (
    <>
      <NavIcon name={row.key} />
      {collapsed ? null : (
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
      )}
      {!collapsed && row.count ? (
        <span className="nav-count">{row.count > 99 ? "99+" : row.count}</span>
      ) : null}
    </>
  );
  const className = cn("nav-row", collapsed && "justify-center px-0");
  // A module that has not arrived yet: shown with the label rather than hidden.
  if (!row.href) {
    return (
      <span
        className={cn(className, "text-muted-foreground")}
        title={row.label}
      >
        {body}
        {collapsed ? null : (
          <Badge variant="outline" className="h-5 px-1.5 text-[0.6875rem]">
            {soonLabel}
          </Badge>
        )}
      </span>
    );
  }
  return (
    <Link
      href={row.href}
      aria-current={active ? "page" : undefined}
      className={className}
      title={collapsed ? row.label : undefined}
    >
      {body}
    </Link>
  );
}

/**
 * The workspace shell of the design reference: a white card on a grey desk, a sidebar of icon
 * rows with their counts, and a breadcrumb bar over the page. The sidebar folds to a rail on a
 * wide screen (remembered) and slides in over the page on a phone.
 */
export function AppFrame({
  labels,
  pinned,
  main,
  admin,
  user,
  footer,
  headerEnd,
  children,
}: Props) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    readCollapsedOnServer,
  );
  const [open, setOpen] = useState(false);
  const toggleCollapsed = () => writeCollapsed(!collapsed);

  const rows = [...pinned, ...main, ...admin];
  const crumbs = crumbsFor(pathname, rows);
  const activeKey = crumbs.at(-1)?.key;
  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  const group = (label: string, items: NavRow[]) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-0.5">
        {collapsed ? (
          <div className="mx-2 my-2 border-t" />
        ) : (
          <p className="nav-section">{label}</p>
        )}
        {items.map((row) => (
          <Row
            key={row.key}
            row={row}
            collapsed={collapsed}
            active={row.key === activeKey}
            soonLabel={labels.soon}
          />
        ))}
      </div>
    );

  return (
    <div className="flex h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="shell-card">
        {/* The phone drawer's scrim. */}
        {open ? (
          <button
            type="button"
            aria-label={labels.close}
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setOpen(false)}
          />
        ) : null}

        <aside
          data-collapsed={collapsed ? "" : undefined}
          // On a phone the sidebar is a drawer over the page: any tap inside it (a link, most of
          // the time) has done its job, so it closes again.
          onClick={() => setOpen(false)}
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-66 shrink-0 flex-col border-r border-border bg-sidebar transition-transform md:static md:z-auto md:translate-x-0 md:transition-[width]",
            collapsed && "md:w-16",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center gap-2 px-3",
              collapsed && "md:justify-center md:px-0",
            )}
          >
            <Link href="/home" className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                <Asterisk className="size-4" aria-hidden />
              </span>
              {collapsed ? null : (
                <>
                  <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.015em]">
                    {labels.workspace}
                  </span>
                  <ChevronDown
                    className="size-3.5 shrink-0 text-faint"
                    aria-hidden
                  />
                </>
              )}
            </Link>
            {collapsed ? null : (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={labels.collapse}
                className="ml-auto hidden size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
              >
                <PanelLeft className="size-4" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={labels.close}
              className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className={cn("px-3 pb-1", collapsed && "md:px-2")}>
            <button
              type="button"
              onClick={openCommandPalette}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-[0.625rem] border border-input bg-background px-3 text-sm text-faint shadow-[0_1px_1px_oklch(0_0_0/3%)] transition-colors hover:bg-muted",
                collapsed && "md:justify-center md:px-0",
              )}
              title={labels.quickActions}
            >
              <Search className="size-4 shrink-0" aria-hidden />
              {collapsed ? null : (
                <>
                  <span className="min-w-0 flex-1 truncate text-left">
                    {labels.quickActions}
                  </span>
                  <kbd className="rounded border border-border px-1 font-sans text-[0.6875rem] text-faint">
                    ⌘K
                  </kbd>
                </>
              )}
            </button>
          </div>

          <nav
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-2 pb-3",
              collapsed && "md:px-2",
            )}
          >
            <div className="flex flex-col gap-0.5">
              {pinned.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  collapsed={collapsed}
                  active={row.key === activeKey}
                  soonLabel={labels.soon}
                />
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              {group(labels.general, main)}
            </div>
            <div className="flex flex-col gap-0.5">
              {group(labels.admin, admin)}
            </div>
          </nav>

          <div
            className={cn(
              "flex shrink-0 flex-col gap-2 border-t border-border p-3",
              collapsed && "md:items-center md:px-2",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[0.6875rem] font-semibold text-muted-foreground">
                {initials}
              </span>
              {collapsed ? null : (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.8125rem] font-medium">
                    {user.name}
                  </span>
                  <span className="truncate text-xs text-faint">
                    {user.email}
                  </span>
                </span>
              )}
            </div>
            {collapsed ? null : footer}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={labels.menu}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            >
              <Menu className="size-4" aria-hidden />
            </button>
            {collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={labels.collapse}
                className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
              >
                <PanelLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span
                    key={crumb.key}
                    className="flex min-w-0 items-center gap-2"
                  >
                    {index > 0 ? <span className="text-faint">/</span> : null}
                    {index === 0 ? (
                      <NavIcon
                        name={crumb.key}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                    <Link
                      href={crumb.href ?? "/home"}
                      className={cn(
                        "truncate",
                        last
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {crumb.label}
                    </Link>
                  </span>
                );
              })}
            </nav>
            {crumbs.at(-1)?.count ? (
              <Badge variant="secondary" className="shrink-0">
                {(crumbs.at(-1)?.count ?? 0) > 99
                  ? "99+"
                  : crumbs.at(-1)?.count}
              </Badge>
            ) : null}
            {headerEnd ? <div className="ml-auto flex shrink-0 items-center gap-2">{headerEnd}</div> : null}
          </header>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
