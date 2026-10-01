"use client";
import { Logo } from "@/components/brand/logo";
import {
  ChevronDown,
  ChevronRight,
  Menu,
  PanelLeft,
  Pin,
  PinOff,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState, useSyncExternalStore, useTransition } from "react";
import { NavIcon } from "@/components/shell/nav-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { openCommandPalette } from "@/components/shell/palette-bus";
import {
  readCollapsed,
  readCollapsedOnServer,
  readFolded,
  readFoldedOnServer,
  subscribeCollapsed,
  subscribeFolded,
  writeCollapsed,
  writeFolded,
} from "@/components/shell/sidebar-store";
import { setNavPinsAction } from "@/modules/platform/auth/preference-actions";
import { MAX_NAV_PINS } from "@/modules/platform/auth/preferences";
import { initialsOf } from "@/lib/text";
import { cn } from "@/lib/utils";

export type NavRow = {
  key: string;
  href?: string;
  label: string;
  count?: number;
};

/** One fold of the sidebar; `end` is drawn under its rows (the preference switches), never on the rail. */
export type NavSection = {
  key: string;
  label: string;
  items: NavRow[];
  end?: ReactNode;
};

export type FrameLabels = {
  workspace: string;
  quickActions: string;
  pinned: string;
  pin: string;
  unpin: string;
  pinLimit: string;
  menu: string;
  close: string;
  collapse: string;
  soon: string;
};

type Props = {
  labels: FrameLabels;
  sections: NavSection[];
  /** The entries this person pinned, as stored on their account; any they are not offered is skipped. */
  pins: string[];
  /** `photoUrl`: the profile picture, when the person has put one up. `footer` sits at the end of their row. */
  user: { name: string; email: string; photoUrl: string | null };
  footer: ReactNode;
  /** At the right end of the header on every page: the feedback button. */
  headerEnd?: ReactNode;
  /** Across the top of the page, above the header: the "seeing the app as…" banner. */
  notice?: ReactNode;
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

const countOf = (count: number) => (count > 99 ? "99+" : count);

type PinControl = {
  pinned: boolean;
  /** Pinning is refused at the limit; unpinning never is. */
  full: boolean;
  labels: Pick<FrameLabels, "pin" | "unpin" | "pinLimit">;
  onToggle: () => void;
};

function Row({
  row,
  collapsed,
  active,
  soonLabel,
  pin,
}: {
  row: NavRow;
  collapsed: boolean;
  active: boolean;
  soonLabel: string;
  /** Absent on the rail and for an entry that has not arrived yet. */
  pin?: PinControl;
}) {
  const body = (
    <>
      <NavIcon name={row.key} />
      {collapsed ? null : (
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
      )}
      {row.count ? (
        <span
          className={cn(
            collapsed ? "nav-count-rail" : "nav-count",
            // A mouse sees the pin where the count was; a finger sees both, side by side.
            pin && "pointer-fine:group-hover/row:invisible pointer-fine:group-has-[:focus-visible]/row:invisible",
          )}
        >
          {countOf(row.count)}
        </span>
      ) : null}
    </>
  );
  const className = cn("nav-row", collapsed && "justify-center px-0", pin && "pointer-coarse:pr-9");
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
  const link = (
    <Link
      href={row.href}
      aria-current={active ? "page" : undefined}
      className={className}
      title={collapsed ? row.label : undefined}
    >
      {body}
    </Link>
  );
  if (!pin) return link;
  const refused = !pin.pinned && pin.full;
  const label = refused ? pin.labels.pinLimit : `${pin.pinned ? pin.labels.unpin : pin.labels.pin}: ${row.label}`;
  const Icon = pin.pinned ? PinOff : Pin;
  return (
    <div className="group/row relative">
      {link}
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={pin.pinned}
        disabled={refused}
        onClick={(event) => {
          // On a phone the drawer shuts on any tap inside it; pinning is not done with it yet.
          event.stopPropagation();
          pin.onToggle();
        }}
        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent pointer-coarse:opacity-70"
      >
        <Icon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function SectionHeading({
  label,
  open,
  count,
  current,
}: {
  label: string;
  open: boolean;
  /** What waits behind the rows of a shut section, so folding it hides no badge. */
  count: number;
  /** The page open now is one of this shut section's rows. */
  current: boolean;
}) {
  return (
    <CollapsibleTrigger
      onClick={(event) => event.stopPropagation()}
      className="nav-section group/heading flex w-full items-center gap-1 rounded-md text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("min-w-0 flex-1 truncate", !open && current && "text-link")}>{label}</span>
      {!open && count ? <span className="nav-count">{countOf(count)}</span> : null}
      <ChevronRight
        className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        aria-hidden
      />
    </CollapsibleTrigger>
  );
}

/**
 * The workspace shell of the design reference: a white card on a grey desk, a sidebar of icon
 * rows with their counts, and a breadcrumb bar over the page. The sidebar folds to a rail on a
 * wide screen (remembered) and slides in over the page on a phone.
 */
export function AppFrame({
  labels,
  sections,
  pins: storedPins,
  user,
  footer,
  headerEnd,
  notice,
  children,
}: Props) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    readCollapsedOnServer,
  );
  const folded = useSyncExternalStore(subscribeFolded, readFolded, readFoldedOnServer);
  const [open, setOpen] = useState(false);
  const toggleCollapsed = () => writeCollapsed(!collapsed);

  // The pins as this sidebar shows them: changed here at once, then saved to the account. The
  // whole list goes each time, so the stored one is always a list this sidebar showed.
  const [pins, setPins] = useState(storedPins);
  const [, startSaving] = useTransition();
  const togglePin = (key: string) => {
    const before = pins;
    const next = pins.includes(key) ? pins.filter((pin) => pin !== key) : [...pins, key];
    setPins(next);
    startSaving(async () => {
      const result = await setNavPinsAction(next);
      if (!result.ok) setPins(before);
    });
  };

  const rows = sections.flatMap((section) => section.items);
  const crumbs = crumbsFor(pathname, rows);
  const activeKey = crumbs.at(-1)?.key;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const pinnedRows = pins.flatMap((key) => byKey.get(key) ?? []);

  const rowOf = (row: NavRow) => (
    <Row
      key={row.key}
      row={row}
      collapsed={collapsed}
      active={row.key === activeKey}
      soonLabel={labels.soon}
      pin={
        row.href && !collapsed
          ? {
              pinned: pins.includes(row.key),
              full: pins.length >= MAX_NAV_PINS,
              labels,
              onToggle: () => togglePin(row.key),
            }
          : undefined
      }
    />
  );

  // On the rail every icon shows, with a rule between sections: a fold there would hide its icons
  // behind nothing a person could open.
  const section = (entry: NavSection, index: number) => {
    if (collapsed) {
      return (
        <div key={entry.key} className="flex flex-col gap-0.5">
          {index > 0 || pinnedRows.length > 0 ? <div className="mx-2 my-2 border-t" /> : null}
          {entry.items.map(rowOf)}
        </div>
      );
    }
    const shut = folded.includes(entry.key);
    return (
      <Collapsible
        key={entry.key}
        open={!shut}
        onOpenChange={(next) => writeFolded(entry.key, !next)}
        className="flex flex-col"
      >
        <SectionHeading
          label={entry.label}
          open={!shut}
          count={entry.items.reduce((sum, row) => sum + (row.count ?? 0), 0)}
          current={entry.items.some((row) => row.key === activeKey)}
        />
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0">
          <div className="flex flex-col gap-0.5">
            {entry.items.map(rowOf)}
            {entry.end}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

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
              <Logo className="size-7 shrink-0 text-brand" />
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
            {pinnedRows.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {collapsed ? null : <p className="nav-section pt-1">{labels.pinned}</p>}
                {pinnedRows.map(rowOf)}
              </div>
            ) : null}
            {sections.map(section)}
          </nav>

          <div
            className={cn(
              "flex shrink-0 flex-col gap-2 border-t border-border p-3",
              collapsed && "md:items-center md:px-2",
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar className="size-7 rounded-lg after:rounded-lg">
                {user.photoUrl ? <AvatarImage src={user.photoUrl} alt={user.name} className="rounded-lg" /> : null}
                <AvatarFallback className="rounded-lg text-[0.6875rem] font-semibold">
                  {initialsOf(user.name)}
                </AvatarFallback>
              </Avatar>
              {collapsed ? null : (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.8125rem] font-medium">
                    {user.name}
                  </span>
                  <span className="truncate text-xs text-faint">
                    {user.email}
                  </span>
                </span>
              )}
              {collapsed ? null : footer}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {notice}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={labels.menu}
              className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            >
              <Menu className="size-4" aria-hidden />
              {/* The drawer is shut on a phone: the button says something waits in it. */}
              {rows.some((row) => row.count) ? <span className="nav-menu-dot" aria-hidden /> : null}
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
