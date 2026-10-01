import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { canReadUnansweredLog, listUnanswered } from "@/modules/ai/service";
import { ResolveUnansweredForm } from "@/modules/ai/ui/resolve-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("unansweredQuestions");

/**
 * What the knowledge base could not answer — the backlog of pages still to write, most-asked
 * first. For the people who keep it (`kb:manage`), because that is what it is for — each keeper
 * the questions of the people inside their grant.
 */
export default async function UnansweredPage(props: PageProps<"/assistant/unanswered">) {
  const user = await requireUser();
  if (!canReadUnansweredLog(user.principal)) notFound();
  const params = await props.searchParams;
  const resolved = params.show === "resolved";
  const [t, format, rows] = await Promise.all([getTranslations("assistant.unanswered"), getFormatter(), listUnanswered(user.principal, { resolved })]);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/assistant" className="hover:underline">
            {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("intro")}
        actions={
          <Segmented
            aria-label={t("title")}
            value={resolved ? "all" : "open"}
            options={[
              { value: "open", label: t("open"), href: "/assistant/unanswered" },
              { value: "all", label: t("all"), href: "/assistant/unanswered?show=resolved" },
            ]}
          />
        }
      />

      <List>
        {rows.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
        {rows.map((row) => (
          <ListItem key={row.id} className="flex-col items-stretch gap-2 py-3">
            <p className="text-sm font-medium">{row.question}</p>
            <p className="text-xs text-faint">
              {t("askedTimes", { count: row.asked })} · <span className="font-mono tabular-nums">{format.dateTime(row.createdAt, { dateStyle: "medium" })}</span> · {row.locale.toUpperCase()}
              {row.bestScore === null ? "" : ` · ${t("bestScore", { score: Math.round(row.bestScore * 100) })}`}
            </p>
            {row.resolvedAt ? (
              <p className="text-xs text-muted-foreground">
                {t("resolvedOn", { date: format.dateTime(row.resolvedAt, { dateStyle: "medium" }) })}
                {row.resolutionNote ? ` — ${row.resolutionNote}` : ""}
              </p>
            ) : (
              <ResolveUnansweredForm id={row.id} />
            )}
          </ListItem>
        ))}
      </List>
    </Page>
  );
}
