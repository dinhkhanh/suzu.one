// The first-sign-in guide: a short tour of what an employee does in SuZu One, in the order a new
// person meets it. Pure — the layout decides whether it opens, the dialog renders the steps.

/** Holds the session that put the guide off, so it stays shut for that session and opens again at the next sign-in. */
export const WELCOME_LATER_COOKIE = "suzu_welcome_later";

export type WelcomeStepKey = "welcome" | "today" | "checkIn" | "me" | "leave" | "tasks" | "daily" | "payslips" | "kb" | "finish";
export type WelcomeStep = { key: WelcomeStepKey; href?: string };

// Each page step names the navigation entry it points at: a step whose entry this person does not
// have (a collaborator without payslips, say) is left out rather than linking to a refusal.
const PAGE_STEPS: { key: WelcomeStepKey; nav: string }[] = [
  { key: "today", nav: "today" },
  { key: "checkIn", nav: "checkIn" },
  { key: "me", nav: "me" },
  { key: "leave", nav: "leave" },
  { key: "tasks", nav: "tasks" },
  { key: "daily", nav: "daily" },
  { key: "payslips", nav: "payslips" },
  { key: "kb", nav: "kb" },
];

/** The steps for someone whose navigation holds `nav` (entry key → href), opening and closing steps included. */
export function welcomeSteps(nav: ReadonlyMap<string, string>): WelcomeStep[] {
  const pages = PAGE_STEPS.flatMap(({ key, nav: entry }) => {
    const href = nav.get(entry);
    return href ? [{ key, href }] : [];
  });
  return [{ key: "welcome" }, ...pages, { key: "finish" }];
}

/** Opens until confirmed, except in the session that put it off. */
export function shouldShowWelcome(input: { completedAt: Date | null; sessionId: string; laterCookie: string | undefined }): boolean {
  return !input.completedAt && input.laterCookie !== input.sessionId;
}
