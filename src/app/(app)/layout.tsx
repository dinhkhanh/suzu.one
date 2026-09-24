import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { AppFrame, type NavRow } from "@/components/shell/app-frame";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { navFor } from "@/components/shell/nav";
import { canRunRecruitment } from "@/modules/recruit/policy";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImpersonationBanner } from "@/modules/platform/auth/ui/impersonation";
import { loadShellCounts } from "@/modules/platform/shell/service";
import { WelcomeGuide } from "@/modules/platform/shell/ui/welcome-guide";
import { shouldShowWelcome, WELCOME_LATER_COOKIE, welcomeSteps } from "@/modules/platform/shell/welcome";
import { getTheme } from "@/theme/server";
import { CommandPalette } from "@/modules/work/ui/command-palette";
import { FeedbackButton } from "@/modules/feedback/ui/feedback-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const theme = await getTheme();
  // One round trip for every badge and membership (app.shell_counts), beside the flags and messages.
  const [t, people, counts, jar] = await Promise.all([getTranslations(), peopleModuleOpen(user), loadShellCounts(user.person.id), cookies()]);
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
  // The first-sign-in guide, until confirmed: it points only at pages this person's sidebar offers.
  // Vietnamese names end with the given name, which is what the greeting uses.
  const welcome = shouldShowWelcome({ completedAt: user.person.welcomeCompletedAt, sessionId: user.sessionId, laterCookie: jar.get(WELCOME_LATER_COOKIE)?.value })
    ? welcomeSteps(new Map([...pinned, ...nav.main].flatMap((item) => (item.href ? [[item.key, item.href] as const] : []))))
    : null;

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
        // Feedback on the app, one click from every page while it is new to everybody.
        headerEnd={<FeedbackButton />}
        // Seeing the app as somebody else (FR-PLT-40) is said on every page, with the way back.
        notice={user.impersonator ? <ImpersonationBanner name={user.person.fullName} personId={user.person.id} /> : null}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <LocaleSwitch compact />
              <ThemeSwitch theme={theme} compact />
            </div>
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
      {welcome ? <WelcomeGuide steps={welcome} name={user.person.fullName.split(" ").at(-1) ?? user.person.fullName} /> : null}
    </>
  );
}
