// Server-rendered pieces shared by the home feed and the comms pages. A body or a message is a
// note (Markdown, rendered by RichText), never HTML.
import { ArrowRight } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { List, ListEmpty } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { cn } from "@/lib/utils";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import type { AnnouncementCard, KudosCard } from "../service";
import { AcknowledgeAnnouncementButton } from "./buttons";

/**
 * Announcements as cards: who and when above the title, two lines of the body, and along the
 * foot the badges and the way in. An unread one is lifted by the accent ring. Opening one is
 * reading it; one that must be acknowledged carries the key for that instead.
 */
export async function AnnouncementCards({ cards, empty }: { cards: AnnouncementCard[]; empty: string }) {
  const t = await getTranslations("comms");
  const format = await getFormatter();
  if (cards.length === 0)
    return (
      <List>
        <ListEmpty>{empty}</ListEmpty>
      </List>
    );
  return (
    <div className="flex flex-col gap-3">
      {cards.map((card, index) => (
        <Card key={card.id} className={cn("rise", !card.read && "bg-primary/3 ring-1 ring-primary/30")} style={{ "--i": index } as CSSProperties}>
          <CardHeader className="gap-1.5">
            <p className="flex items-center gap-2 text-xs text-faint">
              {card.read ? null : <span aria-label={t("list.unread")} className="size-2 shrink-0 rounded-full bg-primary" />}
              <span className="truncate">
                <RecordLink kind="person" id={card.authorPersonId}>
                  {card.authorName}
                </RecordLink>{" "}
                · {format.dateTime(card.publishAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" })}
              </span>
            </p>
            <h3 className="text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
              <RecordLink kind="announcement" id={card.id}>
                {card.title}
              </RecordLink>
            </h3>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-2 text-sm text-muted-foreground">{card.excerpt}</p>
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-2 py-2.5">
            <span className="flex flex-wrap items-center gap-1.5">
              {card.pinned ? <Badge variant="secondary">{t("list.pinned")}</Badge> : null}
              {card.mustAcknowledge ? (
                <Badge variant={card.acknowledged ? "success" : "warning"} dot>
                  {card.acknowledged ? t("list.acknowledged") : t("list.mustAcknowledge")}
                </Badge>
              ) : null}
            </span>
            {card.mustAcknowledge && !card.acknowledged ? (
              <AcknowledgeAnnouncementButton id={card.id} />
            ) : (
              <Link href={`/announcements/${card.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("list.open")}
              </Link>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

const HUES: BadgeVariant[] = ["violet", "teal", "orange", "pink", "indigo"];
/** The same company value is always the same hue, and the hues mean nothing. */
const hueOf = (key: string): BadgeVariant => HUES[[...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length]!;

/** Kudos as cards, two across on a desk: who thanked whom, the words, the value they named. */
export async function KudosCards({ cards, empty, action }: { cards: KudosCard[]; empty: string; action?: (card: KudosCard) => ReactNode }) {
  const t = await getTranslations("comms");
  const format = await getFormatter();
  const locale = await getLocale();
  if (cards.length === 0)
    return (
      <List>
        <ListEmpty>{empty}</ListEmpty>
      </List>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map((card, index) => (
        <Card key={card.id} className="rise" style={{ "--i": index } as CSSProperties}>
          <CardHeader className="gap-2">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <RecordLink kind="person" id={card.fromPersonId} className="font-semibold">
                {card.fromName}
              </RecordLink>
              <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden />
              <RecordLink kind="person" id={card.toPersonId} className="font-semibold">
                {card.toName}
              </RecordLink>
              <span className="sr-only">{t.rich("kudos.line", { from: card.fromName, to: card.toName, b: (chunks) => <>{chunks}</> })}</span>
            </p>
            <Badge variant={hueOf(card.valueKey)}>{(locale === "en" ? card.valueNameEn : card.valueNameVi) ?? card.valueKey}</Badge>
          </CardHeader>
          <CardContent>
            <RichText text={card.message} className="break-words" />
          </CardContent>
          <CardFooter className="justify-between gap-2 py-2.5 text-xs text-faint">
            <span>{format.dateTime(card.createdAt, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" })}</span>
            {action?.(card)}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
