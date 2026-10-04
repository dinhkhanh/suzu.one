import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AI_LIMITS, assistantUsage, canReadAssistantUsage, canReadUnansweredLog, listUnanswered, USAGE_DAYS } from "@/modules/ai/service";
import { ResolveUnansweredForm } from "@/modules/ai/ui/resolve-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("unansweredQuestions");

/**
 * What the knowledge base could not answer — the backlog of pages still to write, most-asked
 * first. For the people who keep it (`kb:manage`), because that is what it is for — each keeper
 * the questions of the people inside their grant.
 *
 * The owner has a third view beside it: what the assistant was used for and what it cost over the
 * last thirty days, per person and per day (`?show=usage`). Anybody else asking for it gets the
 * open questions.
 */
export default async function UnansweredPage(props: PageProps<"/assistant/unanswered">) {
  const user = await requireUser();
  if (!canReadUnansweredLog(user.principal)) notFound();
  const params = await props.searchParams;
  const owner = canReadAssistantUsage(user.principal);
  const view = params.show === "usage" && owner ? "usage" : params.show === "resolved" ? "all" : "open";
  const [t, format, rows, usage] = await Promise.all([
    getTranslations("assistant.unanswered"),
    getFormatter(),
    view === "usage" ? Promise.resolve([]) : listUnanswered(user.principal, { resolved: view === "all" }),
    view === "usage" ? assistantUsage() : Promise.resolve(null),
  ]);

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
            value={view}
            options={[
              { value: "open", label: t("open"), href: "/assistant/unanswered" },
              { value: "all", label: t("all"), href: "/assistant/unanswered?show=resolved" },
              ...(owner ? [{ value: "usage" as const, label: t("usage.tab"), href: "/assistant/unanswered?show=usage" }] : []),
            ]}
          />
        }
      />

      {usage ? (
        <>
          <Section title={t("usage.title", { days: USAGE_DAYS })} description={t("usage.intro", { askDay: AI_LIMITS.ask_day.max, askBurst: AI_LIMITS.ask_burst.max, draftDay: AI_LIMITS.draft_day.max, draftBurst: AI_LIMITS.draft_burst.max })}>
            <TileGrid>
              <Tile label={t("usage.answers")} value={format.number(usage.total.answers)} />
              <Tile label={t("usage.modelAnswers")} value={format.number(usage.total.modelAnswers)} />
              <Tile label={t("usage.inputTokens")} value={format.number(usage.total.inputTokens)} />
              <Tile label={t("usage.outputTokens")} value={format.number(usage.total.outputTokens)} />
            </TileGrid>
          </Section>

          <Section title={t("usage.byPerson")} count={usage.byPerson.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person" className="min-w-40">
                    {t("usage.person")}
                  </TableHead>
                  <TableHead kind="number">{t("usage.answers")}</TableHead>
                  <TableHead kind="number">{t("usage.modelAnswers")}</TableHead>
                  <TableHead kind="number">{t("usage.inputTokens")}</TableHead>
                  <TableHead kind="number">{t("usage.outputTokens")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.byPerson.length === 0 ? <TableEmpty>{t("usage.empty")}</TableEmpty> : null}
                {usage.byPerson.map((row) => (
                  <TableRow key={row.personId}>
                    <TableCell className="font-medium">
                      <RecordLink kind="person" id={row.personId}>
                        {row.fullName}
                      </RecordLink>
                    </TableCell>
                    <TableCell kind="number">{format.number(row.answers)}</TableCell>
                    <TableCell kind="number">{format.number(row.modelAnswers)}</TableCell>
                    <TableCell kind="number">{format.number(row.inputTokens)}</TableCell>
                    <TableCell kind="number">{format.number(row.outputTokens)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title={t("usage.byDay")}>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="date" className="min-w-32">
                    {t("usage.day")}
                  </TableHead>
                  <TableHead kind="number">{t("usage.answers")}</TableHead>
                  <TableHead kind="number">{t("usage.modelAnswers")}</TableHead>
                  <TableHead kind="number">{t("usage.inputTokens")}</TableHead>
                  <TableHead kind="number">{t("usage.outputTokens")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.byDay.length === 0 ? <TableEmpty>{t("usage.empty")}</TableEmpty> : null}
                {usage.byDay.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell className="font-medium">{format.dateTime(new Date(`${row.day}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</TableCell>
                    <TableCell kind="number">{format.number(row.answers)}</TableCell>
                    <TableCell kind="number">{format.number(row.modelAnswers)}</TableCell>
                    <TableCell kind="number">{format.number(row.inputTokens)}</TableCell>
                    <TableCell kind="number">{format.number(row.outputTokens)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </>
      ) : (
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
      )}
    </Page>
  );
}
