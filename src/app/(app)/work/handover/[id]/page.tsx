import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { canRunExitHandover, canViewExitHandover, getExitHandover, loadViewer } from "@/modules/work/service";
import { ExitHandoverForm } from "@/modules/work/ui/exit-handover";

export const metadata: Metadata = { title: "Work handover" };

// FR-PJM-45: everything a leaver (or someone moving on) still owns in work management, live; the
// line manager, the person's team leads and work or HR leaders reassign it in bulk with a note. The
// offboarding step it belongs to cannot be completed until the list is empty.
export default async function ExitHandoverPage({ params }: PageProps<"/work/handover/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [viewer, t, format] = await Promise.all([loadViewer(user), getTranslations("work"), getFormatter()]);
  // Work of a project the runner does not run is listed without its name: they reassign what they run.
  const handover = /^[0-9a-f-]{36}$/.test(id) ? await getExitHandover(id, viewer) : undefined;
  if (!handover || !canViewExitHandover(viewer, handover.facts)) notFound();
  const run = canRunExitHandover(viewer, handover.facts);
  const people = run ? (await listPersonNames()).filter((person) => person.id !== handover.personId) : [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/tasks" className="underline">
            {t("myWork")}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {t("exit.title", { name: handover.personName })}
          <Badge variant={handover.status === "open" ? "secondary" : "outline"}>{t(`exit.statuses.${handover.status}`)}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {[t(`exit.reasons.${handover.reason}`), handover.lastDay ? t("exit.lastDay", { date: format.dateTime(new Date(`${handover.lastDay}T00:00:00`), { dateStyle: "medium" }) }) : null, handover.step ? t("exit.step", { name: handover.step.assigneeName ?? "—" }) : null].filter(Boolean).join(" · ")}
        </p>
        {handover.summary.total ? <p className="text-sm">{t("exit.remaining", { count: handover.summary.total })}</p> : null}
      </header>
      <ExitHandoverForm handoverId={handover.id} owned={handover.owned} people={people} canRun={run} open={handover.status === "open"} />
    </div>
  );
}
