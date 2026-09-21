import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canReadUnansweredLog, listUnanswered } from "@/modules/ai/service";
import { ResolveUnansweredForm } from "@/modules/ai/ui/resolve-form";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Unanswered questions" };

/**
 * What the knowledge base could not answer — the backlog of pages still to write, most-asked
 * first. For the people who keep it (`kb:manage`), because that is what it is for.
 */
export default async function UnansweredPage(props: PageProps<"/assistant/unanswered">) {
  const user = await requireUser();
  if (!canReadUnansweredLog(user.principal)) notFound();
  const params = await props.searchParams;
  const resolved = params.show === "resolved";
  const t = await getTranslations("assistant.unanswered");
  const format = await getFormatter();
  const rows = await listUnanswered({ resolved });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/assistant" className="hover:underline">
            {t("back")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <nav className="tab-row">
          <Link href="/assistant/unanswered" className={resolved ? "text-muted-foreground hover:underline" : "font-medium underline underline-offset-4"}>
            {t("open")}
          </Link>
          <Link href="/assistant/unanswered?show=resolved" className={resolved ? "font-medium underline underline-offset-4" : "text-muted-foreground hover:underline"}>
            {t("all")}
          </Link>
        </nav>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-xl border p-3">
              <p className="text-sm font-medium">{row.question}</p>
              <p className="text-xs text-muted-foreground">
                {t("askedTimes", { count: row.asked })} · {format.dateTime(row.createdAt, { dateStyle: "medium" })} · {row.locale.toUpperCase()}
                {row.bestScore === null ? "" : ` · ${t("bestScore", { score: Math.round(row.bestScore * 100) })}`}
              </p>
              {row.resolvedAt ? <p className="text-xs text-muted-foreground">{t("resolvedOn", { date: format.dateTime(row.resolvedAt, { dateStyle: "medium" }) })}{row.resolutionNote ? ` — ${row.resolutionNote}` : ""}</p> : <ResolveUnansweredForm id={row.id} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
