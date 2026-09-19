import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CollapsibleNav } from "@/components/shell/collapsible-nav";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { navFor, type NavItem } from "@/components/shell/nav";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { countInbox } from "@/modules/platform/approvals/service";
import { requireUser } from "@/modules/platform/auth/session";
import { countUnread } from "@/modules/platform/notifications/service";
import { countMyOpenTasks } from "@/modules/platform/tasks-engine/service";
import { CommandPalette } from "@/modules/work/ui/command-palette";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const nav = navFor(user.principal, { people: await peopleModuleOpen(user) });
  const [unread, waiting, tasks] = await Promise.all([countUnread(user.person.id), countInbox(user.person.id), countMyOpenTasks(user.person.id)]);

  const renderItem = (item: NavItem) =>
    item.href ? (
      <Link key={item.key} href={item.href} className="rounded-md px-2 py-1.5 text-sm hover:bg-muted">
        {t(`nav.${item.key}`)}
      </Link>
    ) : (
      <span key={item.key} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground">
        {t(`nav.${item.key}`)}
        <Badge variant="outline" className="text-[10px]">
          {t("nav.soon")}
        </Badge>
      </span>
    );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b p-3 md:w-56 md:border-r md:border-b-0">
        <CollapsibleNav
          label={t("nav.menu")}
          header={
            <Link href="/home" className="px-2 text-base font-semibold tracking-tight">
              {t("app.name")}
            </Link>
          }
        >
        <nav className="flex flex-col gap-0.5">
          {nav.main.map(renderItem)}
          <Link href="/tasks" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            {t("nav.tasks")}
            {tasks > 0 ? <Badge className="text-[10px]">{tasks > 99 ? "99+" : tasks}</Badge> : null}
          </Link>
          <Link href="/approvals" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            {t("nav.approvals")}
            {waiting > 0 ? <Badge className="text-[10px]">{waiting > 99 ? "99+" : waiting}</Badge> : null}
          </Link>
          <Link href="/notifications" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            {t("nav.notifications")}
            {unread > 0 ? <Badge className="text-[10px]">{unread > 99 ? "99+" : unread}</Badge> : null}
          </Link>
        </nav>
        {nav.admin.length > 0 ? (
          <nav className="flex flex-col gap-0.5">
            <p className="px-2 text-xs font-medium text-muted-foreground uppercase">{t("nav.admin")}</p>
            {nav.admin.map(renderItem)}
          </nav>
        ) : null}
        <div className="mt-auto flex flex-col gap-2 border-t pt-3">
          <div className="px-2">
            <p className="truncate text-sm font-medium">{user.person.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center justify-between">
            <LocaleSwitch />
            <SignOutButton label={t("nav.signOut")} />
          </div>
        </div>
        </CollapsibleNav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      <CommandPalette
        selfId={user.person.id}
        pages={[...nav.main, { key: "tasks", href: "/tasks" }, { key: "approvals", href: "/approvals" }, { key: "notifications", href: "/notifications" }, ...nav.admin].flatMap((item) => (item.href ? [{ label: t(`nav.${item.key}`), href: item.href }] : []))}
      />
    </div>
  );
}
