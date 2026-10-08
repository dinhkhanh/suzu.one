import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AI_LIMITS, assistantUsage, canReadAssistantUsage, canReadUnansweredLog, listFeedback, listUnanswered, USAGE_DAYS } from "@/modules/ai/service";
import { Badge } from "@/components/ui/badge";
import { AnswerMarkdown } from "@/modules/ai/ui/answer-markdown";
import { ResolveUnansweredForm } from "@/modules/ai/ui/resolve-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("unansweredQuestions");

/**
 * What the knowledge base could not answer — the backlog of pages still to write, most-asked
 * first. For the people who keep it (`kb:manage`), because that is what it is for — each keeper
 * the questions of the people inside their grant.
 *
 * Beside it, for the same readers, the đúng / sai people gave on answers (`?show=feedback`, FR-AGT-51).
 * The owner has a fourth view: what the assistant was used for and what it cost over the
 * last thirty days, per person and per day (`?show=usage`). Anybody else asking for it gets the
 * open questions.
 */
export default async function UnansweredPage(props: PageProps<"/assistant/unanswered">) {
  const user = await requireUser();
  if (!canReadUnansweredLog(user.principal)) notFound();
  const params = await props.searchParams;
  const owner = canReadAssistantUsage(user.principal);
  const view = params.show === "usage" && owner ? "usage" : params.show === "feedback" ? "feedback" : params.show === "resolved" ? "all" : "open";
  const [t, tools, format, rows, usage, feedback] = await Promise.all([
    getTranslations("assistant.unanswered"),
    getTranslations("assistant.agent.tools"),
    getFormatter(),
    view === "open" || view === "all" ? listUnanswered(user.principal, { resolved: view === "all" }) : Promise.resolve([]),
    view === "usage" ? assistantUsage() : Promise.resolve(null),
    view === "feedback" ? listFeedback(user.principal) : Promise.resolve(null),
  ]);
  // Dollars, to the cent — and to a hundredth of a cent while the sums are still that small.
  const usd = (microUsd: number) => format.number(microUsd / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: microUsd > 0 && microUsd < 10_000 ? 4 : 2 });

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
              { value: "feedback", label: t("feedback.tab"), href: "/assistant/unanswered?show=feedback" },
              ...(owner ? [{ value: "usage" as const, label: t("usage.tab"), href: "/assistant/unanswered?show=usage" }] : []),
            ]}
          />
        }
      />

      {feedback ? (
        // Đúng / sai on answers (FR-AGT-51): the note, which tier and tools answered — and the
        // question and the answer only when the asker shared them. Never who asked.
        <Section title={t("feedback.title")} description={t("feedback.intro")}>
          <TileGrid>
            <Tile label={t("feedback.right")} value={format.number(feedback.right)} />
            <Tile label={t("feedback.wrong")} value={format.number(feedback.wrong)} />
          </TileGrid>
          <List>
            {feedback.rows.length === 0 ? <ListEmpty>{t("feedback.empty")}</ListEmpty> : null}
            {feedback.rows.map((row) => (
              <ListItem key={row.id} className="flex-col items-stretch gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.verdict === "right" ? "success" : "destructive"}>{t(`feedback.${row.verdict}`)}</Badge>
                  <span className="text-xs text-faint">
                    <span className="font-mono tabular-nums">{format.dateTime(row.createdAt, { dateStyle: "medium" })}</span>
                    {row.tier ? ` · ${t.has(`usage.month.tiers.${row.tier}`) ? t(`usage.month.tiers.${row.tier as "simple"}`) : row.tier}` : ""}
                    {row.model ? ` · ${row.model}` : ""}
                  </span>
                </div>
                {row.note ? <p className="text-sm">{row.note}</p> : <p className="text-sm text-muted-foreground">{t("feedback.noNote")}</p>}
                {row.tools.length > 0 ? <p className="text-xs text-muted-foreground">{t("feedback.tools", { tools: row.tools.map((tool) => (tools.has(tool) ? tools(tool) : tool)).join(" · ") })}</p> : null}
                {row.question ? (
                  <div className="flex flex-col gap-1 border-l-2 border-border pl-2.5 text-[0.8125rem]">
                    <p className="font-medium">{row.question}</p>
                    {/* As the asker read it — markdown turned into elements, never into HTML — kept short. */}
                    {row.answer ? (
                      <div className="max-h-40 overflow-hidden text-muted-foreground [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
                        <AnswerMarkdown body={row.answer} citations={[]} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-faint">{t("feedback.notShared")}</p>
                )}
              </ListItem>
            ))}
          </List>
        </Section>
      ) : usage ? (
        <>
          <Section title={t("usage.month.title")} description={t("usage.month.intro", { everyone: usd(usage.month.budget.dayMicroUsd.everyone), lead: usd(usage.month.budget.dayMicroUsd.lead), office: usd(usage.month.budget.dayMicroUsd.office) })}>
            <TileGrid>
              <Tile label={t("usage.month.spent")} value={usd(usage.month.monthMicroUsd)} />
              <Tile label={t("usage.month.budget")} value={usd(usage.month.budget.monthMicroUsd)} />
              <Tile label={t("usage.month.share")} value={format.number(usage.month.budget.monthMicroUsd > 0 ? usage.month.monthMicroUsd / usage.month.budget.monthMicroUsd : 0, { style: "percent", maximumFractionDigits: 1 })} />
            </TileGrid>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="text" className="min-w-40">
                    {t("usage.month.model")}
                  </TableHead>
                  <TableHead kind="number">{t("usage.month.calls")}</TableHead>
                  <TableHead kind="money">{t("usage.cost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.month.byModel.length === 0 ? <TableEmpty>{t("usage.month.empty")}</TableEmpty> : null}
                {usage.month.byModel.map((row) => (
                  <TableRow key={`${row.model}:${row.tier}`}>
                    <TableCell className="font-medium">
                      {row.model} <span className="text-xs text-muted-foreground">· {t(`usage.month.tiers.${row.tier as "simple"}`)}</span>
                    </TableCell>
                    <TableCell kind="number">{format.number(row.calls)}</TableCell>
                    <TableCell kind="money">{usd(row.costMicroUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title={t("usage.title", { days: USAGE_DAYS })} description={t("usage.intro", { askDay: AI_LIMITS.ask_day.max, askBurst: AI_LIMITS.ask_burst.max, draftDay: AI_LIMITS.draft_day.max, draftBurst: AI_LIMITS.draft_burst.max })}>
            <TileGrid>
              <Tile label={t("usage.answers")} value={format.number(usage.total.answers)} />
              <Tile label={t("usage.modelAnswers")} value={format.number(usage.total.modelAnswers)} />
              <Tile label={t("usage.inputTokens")} value={format.number(usage.total.inputTokens)} />
              <Tile label={t("usage.outputTokens")} value={format.number(usage.total.outputTokens)} />
              <Tile label={t("usage.cost")} value={usd(usage.total.costMicroUsd)} />
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
                  <TableHead kind="money">{t("usage.cost")}</TableHead>
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
                    <TableCell kind="money">{usd(row.costMicroUsd)}</TableCell>
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
                  <TableHead kind="money">{t("usage.cost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.byDay.length === 0 ? <TableEmpty>{t("usage.empty")}</TableEmpty> : null}
                {usage.byDay.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell className="font-medium">{format.dateTime(new Date(`${row.day}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</TableCell>
                    <TableCell kind="number">{format.number(row.answers)}</TableCell>
                    <TableCell kind="number">{format.number(row.modelAnswers)}</TableCell>
                    <TableCell kind="money">{usd(row.costMicroUsd)}</TableCell>
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
