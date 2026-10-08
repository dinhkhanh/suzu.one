"use client";
import { Logo } from "@/components/brand/logo";
import { Bell, ChevronDown, ChevronRight, LayoutGrid, PanelLeft, Pin, PinOff, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { LinkPending } from "@/components/shell/link-pending";
import { NavIcon } from "@/components/shell/nav-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { openCommandPalette } from "@/components/shell/palette-bus";
import { QuickAdd, type QuickAddLabels } from "@/components/shell/quick-add";
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
import { useSwipeToClose } from "@/components/shell/use-swipe-to-close";
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

/** One fold of the sidebar; `controls` are drawn as rows under its items (the preference switches), never on the rail. */
export type NavSection = {
  key: string;
  label: string;
  items: NavRow[];
  controls?: { key: string; label: string; control: ReactNode }[];
};

/** The phone's tab bar: four stops with a page each, and "More", which opens the full menu. */
export type TabStop = { key: "today" | "work" | "notifications" | "me"; href: string; label: string; count?: number };

export type FrameLabels = {
  workspace: string;
  quickActions: string;
  pinned: string;
  pin: string;
  unpin: string;
  pinLimit: string;
  menu: string;
  more: string;
  close: string;
  collapse: string;
  soon: string;
  notifications: string;
};

type Props = {
  labels: FrameLabels;
  sections: NavSection[];
  tabs: TabStop[];
  quickAdd: QuickAddLabels;
  /** Unread notifications: the dot on the header's bell. */
  unread: number;
  /** The entries this person pinned, as stored on their account; any they are not offered is skipped. */
  pins: string[];
  /** `photoUrl`: the profile picture, when the person has put one up. `footer` sits at the end of their row. */
  user: { name: string; email: string; photoUrl: string | null };
  footer: ReactNode;
  /** At the right end of the header on every page: the assistant's sheet and the feedback button. */
  headerEnd?: ReactNode;
  /** Across the top of the page, above the header: the "seeing the app as…" banner. */
  notice?: ReactNode;
  children: ReactNode;
};

// A stored href is the crumb for every path below it, so /assets/bookings reads
// "Assets / Equipment bookings" and a person's page reads "People".
function crumbsFor(pathname: string, rows: NavRow[]): NavRow[] {
  const matches = rows.filter((row) => row.href && (pathname === row.href || pathname.startsWith(`${row.href}/`)));
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

function Row({ row, collapsed, active, soonLabel, pin }: { row: NavRow; collapsed: boolean; active: boolean; soonLabel: string; /** Absent on the rail and for an entry that has not arrived yet. */ pin?: PinControl }) {
  const body = (
    <>
      <NavIcon name={row.key} />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{row.label}</span>}
      {row.count ? (
        <span
          // Keyed by the number, so a count that changes pops again (globals.css).
          key={row.count}
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
      <span className={cn(className, "text-muted-foreground")} title={row.label}>
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
    <Link href={row.href} aria-current={active ? "page" : undefined} className={className} title={collapsed ? row.label : undefined}>
      {body}
      <LinkPending />
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
        className="absolute top-1 right-1 flex size-5 max-md:top-3 max-md:right-2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent pointer-coarse:opacity-70"
      >
        <Icon className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function SectionHeading({ label, open, count, current }: { label: string; open: boolean; /** What waits behind the rows of a shut section, so folding it hides no badge. */ count: number; /** The page open now is one of this shut section's rows. */ current: boolean }) {
  return (
    <CollapsibleTrigger onClick={(event) => event.stopPropagation()} className="nav-section group/heading mt-3 w-full rounded-md text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn("min-w-0 flex-1 truncate", !open && current && "text-primary")}>{label}</span>
      {!open && count ? <span className="nav-count">{countOf(count)}</span> : null}
      <ChevronRight className={cn("size-3 shrink-0 text-faint transition-transform duration-200 ease-(--ease-settle)", open && "rotate-90")} aria-hidden />
    </CollapsibleTrigger>
  );
}

const TAB_ICON: Record<TabStop["key"], string> = { today: "today", work: "work", notifications: "notifications", me: "me" };

/**
 * The workspace shell: a tinted sidebar of 28px icon rows beside the white page on a desk, folding
 * to a rail (remembered); on a phone the page alone, a tab bar of five stops along the bottom and
 * the full menu sliding in over it from "More". A 52px header carries the breadcrumb, the bell and
 * the feedback button.
 */
export function AppFrame({ labels, sections, tabs, quickAdd, unread, pins: storedPins, user, footer, headerEnd, notice, children }: Props) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, readCollapsedOnServer);
  const folded = useSyncExternalStore(subscribeFolded, readFolded, readFoldedOnServer);
  // The phone drawer remembers the page it was opened on, so it is shut on every other page.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);
  const drawer = useRef<HTMLElement>(null);
  useSwipeToClose(drawer, open, useCallback(() => setOpenAt(null), []));
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
  // Which tab stop the page belongs to: the stop whose page is the first crumb, else none.
  const activeTab = tabs.find((tab) => crumbs[0]?.href === tab.href || pathname === tab.href || pathname.startsWith(`${tab.href}/`))?.key;

  const rowOf = (row: NavRow) => (
    <Row
      key={row.key}
      row={row}
      collapsed={collapsed}
      active={row.key === activeKey}
      soonLabel={labels.soon}
      pin={row.href && !collapsed ? { pinned: pins.includes(row.key), full: pins.length >= MAX_NAV_PINS, labels, onToggle: () => togglePin(row.key) } : undefined}
    />
  );

  // On the rail every icon shows, with a rule between sections: a fold there would hide its icons
  // behind nothing a person could open.
  const section = (entry: NavSection, index: number) => {
    if (collapsed) {
      return (
        <div key={entry.key} className="flex flex-col gap-px">
          {index > 0 || pinnedRows.length > 0 ? <div className="mx-2 my-2 border-t" /> : null}
          {entry.items.map(rowOf)}
        </div>
      );
    }
    const shut = folded.includes(entry.key);
    return (
      <Collapsible key={entry.key} open={!shut} onOpenChange={(next) => writeFolded(entry.key, !next)} className="flex flex-col">
        <SectionHeading label={entry.label} open={!shut} count={entry.items.reduce((sum, row) => sum + (row.count ?? 0), 0)} current={entry.items.some((row) => row.key === activeKey)} />
        <CollapsibleContent>
          <div className="flex flex-col gap-px">
            {entry.items.map(rowOf)}
            {entry.controls?.map((row) => (
              <div key={row.key} className="flex h-8 items-center gap-2.5 px-2 text-[0.8125rem] font-medium text-sidebar-foreground">
                <NavIcon name={row.key} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.control}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)]">
      <div className="shell">
        {/* The phone drawer's scrim: always there, so it fades out with the drawer rather than vanishing before it. */}
        <button
          type="button"
          aria-label={labels.close}
          inert={!open}
          className={cn("fixed inset-0 z-40 bg-ink/30 transition-opacity duration-300 ease-(--ease-drawer) md:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
          onClick={() => setOpen(false)}
        />

        <aside
          ref={drawer}
          data-collapsed={collapsed ? "" : undefined}
          // On a phone the sidebar is a drawer over the page: any tap inside it (a link, most of
          // the time) has done its job, so it closes again.
          onClick={() => setOpen(false)}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] shrink-0 touch-pan-y flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-(--ease-drawer) pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] md:static md:touch-auto md:pt-0 md:pl-0 md:ease-(--ease-settle) md:z-auto md:w-60 md:translate-x-0 md:transition-[width]",
            collapsed && "md:w-14",
            open ? "translate-x-0 shadow-(--float-shadow)" : "-translate-x-full",
          )}
        >
          <div className={cn("flex h-13 shrink-0 items-center gap-2 px-3", collapsed && "md:justify-center md:px-0")}>
            <Link href="/home" className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-1 pl-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Logo className="size-5 shrink-0 text-brand" />
              {collapsed ? null : (
                <>
                  <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">{labels.workspace}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-faint" aria-hidden />
                </>
              )}
            </Link>
            {collapsed ? null : (
              <button type="button" onClick={toggleCollapsed} aria-label={labels.collapse} className="ml-auto hidden size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:flex">
                <PanelLeft className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="ml-auto flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent md:hidden">
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className={cn("px-2.5 pb-1", collapsed && "md:px-2")}>
            <button
              type="button"
              onClick={openCommandPalette}
              className={cn(
                "press flex h-8 w-full items-center gap-2 rounded-[8px] border border-border bg-background px-2.5 text-[0.8125rem] text-faint shadow-[0_1px_1px_oklch(0_0_0/3%)] hover:text-muted-foreground",
                collapsed && "md:justify-center md:px-0",
              )}
              title={labels.quickActions}
            >
              <Search className="size-4 shrink-0" aria-hidden />
              {collapsed ? null : (
                <>
                  <span className="min-w-0 flex-1 truncate text-left">{labels.quickActions}</span>
                  <kbd className="rounded border border-border bg-background px-1 font-mono text-[0.625rem] text-faint">⌘K</kbd>
                </>
              )}
            </button>
          </div>

          <nav className={cn("relative flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain px-2.5 pt-1 pb-3", collapsed && "md:px-2")}>
            {pinnedRows.length > 0 ? (
              <div className="flex flex-col gap-px">
                {collapsed ? null : <p className="nav-section mt-1">{labels.pinned}</p>}
                {pinnedRows.map(rowOf)}
              </div>
            ) : null}
            {sections.map(section)}
          </nav>

          <div className={cn("flex shrink-0 flex-col gap-2 border-t border-sidebar-border p-2.5", collapsed && "md:items-center md:px-2")}>
            <div className="flex items-center gap-2">
              <Avatar className="size-7">
                {user.photoUrl ? <AvatarImage src={user.photoUrl} alt={user.name} /> : null}
                <AvatarFallback className="text-[0.6875rem] font-semibold">{initialsOf(user.name)}</AvatarFallback>
              </Avatar>
              {collapsed ? null : (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.8125rem] font-medium text-foreground">{user.name}</span>
                  <span className="truncate text-[0.6875rem] text-faint">{user.email}</span>
                </span>
              )}
              {collapsed ? null : footer}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {notice}
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:h-13 md:px-5">
            {collapsed ? (
              <button type="button" onClick={toggleCollapsed} aria-label={labels.collapse} className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:flex">
                <PanelLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span key={crumb.key} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden /> : null}
                    {index === 0 ? <NavIcon name={crumb.key} className="size-4 shrink-0 text-muted-foreground" /> : null}
                    <Link href={crumb.href ?? "/home"} className={cn("truncate", last ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground")}>
                      {crumb.label}
                    </Link>
                  </span>
                );
              })}
            </nav>
            {crumbs.at(-1)?.count ? (
              <Badge variant="secondary" className="shrink-0">
                {countOf(crumbs.at(-1)?.count ?? 0)}
              </Badge>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {headerEnd}
              {/* On a phone the bell is a stop of the tab bar. */}
              <Link href="/notifications" aria-label={labels.notifications} className="press relative hidden size-8 md:flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <Bell className="size-[1.125rem]" aria-hidden />
                {unread > 0 ? <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background" /> : null}
              </Link>
            </div>
          </header>

          {/* `relative`: the hidden inputs Base UI puts beside its checkboxes and selects are absolutely placed, and would otherwise hang off the document and scroll the whole window. */}
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:px-8 md:py-7 md:pb-12">{children}</main>
        </div>
      </div>

      {/* Not over the assistant's page: its question box takes the foot of the screen. */}
      {pathname === "/assistant" || pathname.startsWith("/assistant/") ? null : <QuickAdd labels={quickAdd} />}

      <nav className="tab-bar" aria-label={labels.menu}>
        {tabs.map((tab) => (
          <Link key={tab.key} href={tab.href} aria-current={activeTab === tab.key ? "page" : undefined} className="tab-stop press">
            {tab.count ? (
              <span key={tab.count} className="tab-count">
                {countOf(tab.count)}
              </span>
            ) : null}
            <NavIcon name={TAB_ICON[tab.key]} />
            {tab.label}
            <LinkPending />
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={cn("tab-stop press", open && "text-primary")}>
          <LayoutGrid aria-hidden />
          {labels.more}
        </button>
      </nav>
    </div>
  );
}
