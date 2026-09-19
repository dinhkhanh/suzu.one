import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listMyIntakeRequests, listOpenIntakeForms, loadViewer } from "@/modules/work/service";

export const metadata: Metadata = { title: "Request work" };

// FR-WRK-16: the request forms this person may fill in, by team, and what became of their earlier requests.
export default async function IntakeIndexPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const [forms, mine] = await Promise.all([listOpenIntakeForms(viewer), listMyIntakeRequests(user.person.id)]);
  const t = await getTranslations("work.intake");
  const tWork = await getTranslations("work");
  const format = await getFormatter();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {tWork("title")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("indexDescription")}</p>
      </header>

      {forms.length === 0 ? <p className="text-sm text-muted-foreground">{t("noneOpen")}</p> : null}
      {[...Map.groupBy(forms, (form) => form.teamName)].map(([teamName, own]) => (
        <section key={teamName} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{teamName}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {own.map((form) => (
              <li key={form.id} className="p-3">
                <Link href={`/work/intake/${form.id}`} className="font-medium hover:underline">
                  {form.name}
                </Link>
                {form.description ? <p className="text-xs text-muted-foreground">{form.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {mine.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("myRequests")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {mine.map((request) => (
              <li key={request.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/work/tasks/${request.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{request.key}</span> {request.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[request.formName, format.dateTime(request.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge variant="outline">{request.stateName}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
