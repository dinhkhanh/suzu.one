import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { AppFrame, type NavRow, type TabStop } from "@/components/shell/app-frame";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { groupNav, navFor } from "@/components/shell/nav";
import { canRunRecruitment } from "@/modules/recruit/policy";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { photoUrlOf } from "@/modules/core-hr/ui/person-avatar";
import { MAX_NAV_PINS } from "@/modules/platform/auth/preferences";
import { requireUser } from "@/modules/platform/auth/session";
import { ImpersonationBanner } from "@/modules/platform/auth/ui/impersonation";
import { vapidPublicKey } from "@/modules/platform/notifications/push";
import { PushPrompt } from "@/modules/platform/notifications/ui/push-prompt";
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
  // What waits for this person: the sidebar's first section.
  const today: NavRow[] = [
    // The day starts here (FR-PJM-20): the landing page after sign-in.
    { key: "today", href: "/today", label: label("today") },
    { key: "tasks", href: "/tasks", label: label("tasks"), count: tasks },
    { key: "approvals", href: "/approvals", label: label("approvals"), count: waiting },
    { key: "notifications", href: "/notifications", label: label("notifications"), count: unread },
  ];
  const row = (item: { key: string; href?: string }): NavRow => ({ key: item.key, href: item.href, label: label(item.key) });
  // Today's inboxes, the modules, the preferences and the admin desk, sorted into the sidebar's
  // folds (nav.ts). The language and the theme are switched in place, under the preference rows.
  // The phone's tab bar: the day, the work, what waits for me, and me. "More" opens the rest.
  const tabs: TabStop[] = [
    { key: "today", href: "/today", label: t("nav.tabs.today") },
    { key: "work", href: "/work", label: t("nav.tabs.work") },
    { key: "inbox", href: "/tasks", label: t("nav.tabs.inbox"), count: tasks },
    { key: "me", href: "/me", label: t("nav.tabs.me") },
  ];
  const quickAdd = { title: t("nav.quickAdd.title"), button: t("nav.quickAdd.button"), task: t("nav.quickAdd.task"), taskHint: t("nav.quickAdd.taskHint"), time: t("nav.quickAdd.time"), timeHint: t("nav.quickAdd.timeHint"), leave: t("nav.quickAdd.leave"), leaveHint: t("nav.quickAdd.leaveHint"), request: t("nav.quickAdd.request"), requestHint: t("nav.quickAdd.requestHint"), cancel: t("nav.quickAdd.cancel") };
  const sections = groupNav([...today, ...nav.main.map(row), row({ key: "notificationSettings", href: "/notifications#settings" }), ...nav.admin.map(row)]).map((section) => ({
    key: section.key,
    label: t(`nav.sections.${section.key}`),
    items: section.items,
    // The language and the theme are switched in place, under the preference rows; the shell draws
    // the rows (icon, label) around the controls handed to it.
    controls: section.key === "preferences" ? [{ key: "language", label: label("language"), control: <LocaleSwitch compact /> }, { key: "appearance", label: label("appearance"), control: <ThemeSwitch theme={theme} compact /> }] : undefined,
  }));
  // The first-sign-in guide, until confirmed: it points only at pages this person's sidebar offers.
  // Vietnamese names end with the given name, which is what the greeting uses.
  const welcome = shouldShowWelcome({ completedAt: user.person.welcomeCompletedAt, sessionId: user.sessionId, laterCookie: jar.get(WELCOME_LATER_COOKIE)?.value })
    ? welcomeSteps(new Map([...today, ...nav.main].flatMap((item) => (item.href ? [[item.key, item.href] as const] : []))))
    : null;

  return (
    <>
      <AppFrame
        labels={{
          workspace: t("app.name"),
          quickActions: t("nav.quickActions"),
          pinned: t("nav.pinned"),
          pin: t("nav.pin"),
          unpin: t("nav.unpin"),
          pinLimit: t("nav.pinLimit", { max: MAX_NAV_PINS }),
          menu: t("nav.menu"),
          close: t("nav.close"),
          collapse: t("nav.collapse"),
          soon: t("nav.soon"),
          more: t("nav.tabs.more"),
          notifications: t("nav.notifications"),
        }}
        sections={sections}
        tabs={tabs}
        quickAdd={quickAdd}
        unread={unread}
        pins={user.preferences.navPins}
        user={{ name: user.person.fullName, email: user.email, photoUrl: photoUrlOf(user.person) }}
        // Feedback on the app, one click from every page while it is new to everybody.
        headerEnd={<FeedbackButton />}
        // Seeing the app as somebody else (FR-PLT-40) is said on every page, with the way back.
        // Below it, once: the offer to get pushes on this device. Not while borrowing somebody's
        // view — the device would end up registered for them.
        notice={
          <>
            {user.impersonator ? <ImpersonationBanner name={user.person.fullName} personId={user.person.id} /> : null}
            {user.impersonator ? null : <PushPrompt vapidPublicKey={vapidPublicKey()} personId={user.person.id} />}
          </>
        }
        footer={<SignOutButton label={t("nav.signOut")} compact />}
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
