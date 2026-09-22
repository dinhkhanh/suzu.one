import { getTranslations } from "next-intl/server";
import { AppFrame, type NavRow } from "@/components/shell/app-frame";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { navFor } from "@/components/shell/nav";
import { canRunRecruitment } from "@/modules/recruit/policy";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { loadShellCounts } from "@/modules/platform/shell/service";
import { CommandPalette } from "@/modules/work/ui/command-palette";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  // One round trip for every badge and membership (app.shell_counts), beside the flags and messages.
  const [t, people, counts] = await Promise.all([getTranslations(), peopleModuleOpen(user), loadShellCounts(user.person.id)]);
  const nav = navFor(user.principal, {
    people,
    recruit: canRunRecruitment(user.principal) || counts.onHiringTeam,
    interviews: counts.interviewer,
  });
  const { unread, inbox: waiting, openTasks, reviews, handoffs, blockers } = counts;
  // "My work" is one inbox (FR-WRK-06): tasks of every kind, deliverables to review, requests to
  // approve, hand-offs to accept and blockers waiting on me (FR-PJM-40, 28).
  const tasks = openTasks + reviews + waiting + handoffs + blockers;

  const label = (key: string) => t(`nav.${key}`);
  // What waits for this person, at the top of the sidebar; then the modules, then the admin desk.
  const pinned: NavRow[] = [
    // The day starts here (FR-PJM-20): the landing page after sign-in.
    { key: "today", href: "/today", label: label("today") },
    { key: "tasks", href: "/tasks", label: label("tasks"), count: tasks },
    { key: "approvals", href: "/approvals", label: label("approvals"), count: waiting },
    { key: "notifications", href: "/notifications", label: label("notifications"), count: unread },
  ];
  const row = (item: { key: string; href?: string }): NavRow => ({ key: item.key, href: item.href, label: label(item.key) });
  const main = nav.main.map(row);
  const admin = nav.admin.map(row);

  return (
    <>
      <AppFrame
        labels={{
          workspace: t("app.name"),
          quickActions: t("nav.quickActions"),
          general: t("nav.general"),
          admin: t("nav.admin"),
          menu: t("nav.menu"),
          close: t("nav.close"),
          collapse: t("nav.collapse"),
          soon: t("nav.soon"),
        }}
        pinned={pinned}
        main={main}
        admin={admin}
        user={{ name: user.person.fullName, email: user.email }}
        footer={
          <div className="flex items-center justify-between gap-2">
            <LocaleSwitch compact />
            <SignOutButton label={t("nav.signOut")} />
          </div>
        }
      >
        {children}
      </AppFrame>
      <CommandPalette
        selfId={user.person.id}
        pages={[{ key: "today", href: "/today" }, ...nav.main, { key: "tasks", href: "/tasks" }, { key: "approvals", href: "/approvals" }, { key: "notifications", href: "/notifications" }, ...nav.admin].flatMap((item) => (item.href ? [{ label: label(item.key), href: item.href }] : []))}
      />
    </>
  );
}
