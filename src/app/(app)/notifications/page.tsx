import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties } from "react";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { messageKey, resolveParams } from "@/modules/platform/notifications/kinds";
import { messengerConfig } from "@/modules/platform/notifications/messenger";
import { getMessengerStatus } from "@/modules/platform/notifications/messenger-links";
import { vapidPublicKey } from "@/modules/platform/notifications/push";
import { telegramConfig } from "@/modules/platform/notifications/telegram";
import { getTelegramStatus, type TelegramStatus } from "@/modules/platform/notifications/telegram-links";
import { getPreferences, listNotifications, listPushSubscriptions, NOTIFICATIONS_PAGE_SIZE } from "@/modules/platform/notifications/service";
import { MarkAllReadButton, OpenNotificationButton, PreferencesForm } from "@/modules/platform/notifications/ui/notification-centre";
import { MessengerLink } from "@/modules/platform/notifications/ui/messenger-link";
import { PushToggle } from "@/modules/platform/notifications/ui/push-toggle";
import { TelegramLink } from "@/modules/platform/notifications/ui/telegram-link";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("notifications");

const GROUPS = ["today", "yesterday", "earlier"] as const;
type Group = (typeof GROUPS)[number];

export default async function NotificationsPage(props: PageProps<"/notifications">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const page = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1;

  const [t, anyText, format, { rows, total }, preferences, devices, messenger, telegram] = await Promise.all([
    getTranslations("notifications"),
    getTranslations(),
    getFormatter(),
    listNotifications(user.person.id, page),
    getPreferences(user.person.id),
    listPushSubscriptions(user.person.id),
    getMessengerStatus(user.person.id),
    getTelegramStatus(user.person.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const now = new Date();
  // The page's rows under three captions, by the day they arrived (Vietnam time).
  const today = todayInVietnam(now);
  const yesterday = addDays(today, -1);
  const groupOf = (at: Date): Group => {
    const day = todayInVietnam(at);
    return day === today ? "today" : day === yesterday ? "yesterday" : "earlier";
  };
  const groups = GROUPS.map((group) => ({ group, rows: rows.filter((row) => groupOf(row.createdAt) === group) })).filter((entry) => entry.rows.length > 0);

  return (
    <Page width="narrow">
      <PageHeader title={t("title")} actions={rows.some((row) => !row.readAt) ? <MarkAllReadButton /> : null} />

      {rows.length === 0 ? (
        <List>
          <ListEmpty>{t("empty")}</ListEmpty>
        </List>
      ) : null}

      {groups.map(({ group, rows: inGroup }) => (
        <Section key={group} title={t(`groups.${group}`)} count={inGroup.length}>
          <List>
            {inGroup.map((row, index) => {
              const key = messageKey(row.kind);
              // A kind removed from the catalogue still shows, by its raw name.
              const known = t.has(`kinds.${key}.title`);
              const params = resolveParams(row.params, (messageId) => (anyText.has(messageId) ? anyText(messageId) : messageId));
              const unread = !row.readAt;
              return (
                <ListItem key={row.id} className="rise items-start gap-3" style={{ "--i": index } as CSSProperties}>
                  {/* An unread row is told by the accent dot and its medium title; a read one is dimmed. */}
                  <span aria-hidden className={cn("mt-[0.4375rem] size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className={cn("text-sm", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {known ? t(`kinds.${key}.title`, params) : row.kind}
                      <span className="sr-only"> ({unread ? t("unread") : t("read")})</span>
                    </p>
                    {known ? <p className={cn("text-sm", unread ? "text-foreground/80" : "text-muted-foreground/80")}>{t(`kinds.${key}.body`, params)}</p> : null}
                    <time className="text-xs text-faint" dateTime={row.createdAt.toISOString()}>
                      {format.relativeTime(row.createdAt, now)}
                    </time>
                  </div>
                  {row.link || unread ? <OpenNotificationButton id={row.id} link={row.link} unread={unread} label={row.link ? t("open") : t("markRead")} /> : null}
                </ListItem>
              );
            })}
          </List>
        </Section>
      ))}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("page", { page, pageCount })}</span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={`/notifications?page=${page - 1}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("previous")}
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={`/notifications?page=${page + 1}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("next")}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}

      {/* Where the sidebar's "Notification settings" lands: every channel, then every category. */}
      <Section id="settings" title={t("settings")} className="scroll-mt-16 gap-4">
        <PushToggle vapidPublicKey={vapidPublicKey()} personId={user.person.id} deviceCount={devices.length} />
        <TelegramLink configured={telegramConfig() !== null} status={serialise(telegram)} />
        <MessengerLink configured={messengerConfig() !== null} status={serialise(messenger)} />
        <PreferencesForm preferences={preferences} />
      </Section>
    </Page>
  );
}

/** A chat app's link status as the client panel takes it: dates as strings. */
function serialise(status: TelegramStatus) {
  return {
    link: status.link ? { linkedAt: status.link.linkedAt.toISOString(), lastSuccessAt: status.link.lastSuccessAt?.toISOString() ?? null } : null,
    pending: status.pending ? { expiresAt: status.pending.expiresAt.toISOString(), codeSent: status.pending.codeSent } : null,
  };
}
