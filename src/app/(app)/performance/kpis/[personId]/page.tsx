import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { canEnterActualsFor, canManageAssignmentsOf, canReadPerformanceOf, loadDirectory } from "@/modules/performance/service";
import { readMonth } from "@/modules/performance/ui/kpi";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ScorecardView } from "@/modules/performance/ui/scorecard";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "KPIs" };

// Someone else's scorecard: personal tier — the line above them, HR and leaders in scope. Anyone else: 404.
export default async function PersonKpisPage({ params, searchParams }: PageProps<"/performance/kpis/[personId]">) {
  const user = await requireUser();
  const { personId } = await params;
  const person = /^[0-9a-f-]{36}$/.test(personId) ? (await loadDirectory()).get(personId) : undefined;
  if (!person || !canReadPerformanceOf(user.principal, person)) notFound();
  const month = readMonth((await searchParams).month, todayInVietnam());
  const t = await getTranslations("performance");
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("kpi.personTitle", { name: person.fullName })}</h1>
          <p className="text-sm text-muted-foreground">{t("kpi.personDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {canEnterActualsFor(user.principal, person) ? (
            <Link href={`/performance/team/actuals?month=${month}`} className="underline underline-offset-4">
              {t("team.enter")}
            </Link>
          ) : null}
          {canManageAssignmentsOf(user.principal, person) ? (
            <Link href={`/performance/admin/assignments?person=${person.personId}`} className="underline underline-offset-4">
              {t("assignments.manage")}
            </Link>
          ) : null}
        </div>
      </header>
      <PerformanceNav active={person.personId === user.person.id ? "kpis" : "team"} />
      <ScorecardView personId={person.personId} month={month} basePath={`/performance/kpis/${person.personId}`} />
    </div>
  );
}
