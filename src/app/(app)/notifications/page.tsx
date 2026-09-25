import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { messageKey, resolveParams } from "@/modules/platform/notifications/kinds";
import { messengerConfig } from "@/modules/platform/notifications/messenger";
import { getMessengerStatus } from "@/modules/platform/notifications/messenger-links";
import { vapidPublicKey } from "@/modules/platform/notifications/push";
import { getPreferences, listNotifications, listPushSubscriptions, NOTIFICATIONS_PAGE_SIZE } from "@/modules/platform/notifications/service";
import { MarkAllReadButton, OpenNotificationButton, PreferencesForm } from "@/modules/platform/notifications/ui/notification-centre";
import { MessengerLink } from "@/modules/platform/notifications/ui/messenger-link";
import { PushToggle } from "@/modules/platform/notifications/ui/push-toggle";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("notifications");

export default async function NotificationsPage(props: PageProps<"/notifications">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const page = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1;

  const [t, anyText, format, { rows, total }, preferences, devices, messenger] = await Promise.all([
    getTranslations("notifications"),
    getTranslations(),
    getFormatter(),
    listNotifications(user.person.id, page),
    getPreferences(user.person.id),
    listPushSubscriptions(user.person.id),
    getMessengerStatus(user.person.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const now = new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{t("title")}</h1>
        {rows.some((row) => !row.readAt) ? <MarkAllReadButton /> : null}
      </header>

      <ul className="flex flex-col divide-y overflow-hidden rounded-xl border">
        {rows.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{t("empty")}</li> : null}
        {rows.map((row) => {
          const key = messageKey(row.kind);
          // A kind removed from the catalogue still shows, by its raw name.
          const known = t.has(`kinds.${key}.title`);
          const params = resolveParams(row.params, (messageId) => (anyText.has(messageId) ? anyText(messageId) : messageId));
          return (
            <li key={row.id} className={`relative flex items-start justify-between gap-4 p-4 ${row.readAt ? "" : "bg-primary/5"}`}>
              {/* Unread rows carry an accent bar, a filled dot, a bold title and a solid button; read rows are dimmed. */}
              {row.readAt ? null : <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" />}
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${row.readAt ? "border border-muted-foreground/40" : "bg-primary"}`} />
              <div className="min-w-0 flex-1">
                <p className={`flex flex-wrap items-center gap-2 text-sm ${row.readAt ? "font-normal text-muted-foreground" : "font-semibold text-foreground"}`}>
                  {known ? t(`kinds.${key}.title`, params) : row.kind}
                  <span className="sr-only">({row.readAt ? t("read") : t("unread")})</span>
                  {row.readAt ? null : (
                    <Badge variant="info" dot aria-hidden>
                      {t("unread")}
                    </Badge>
                  )}
                </p>
                {known ? <p className={`text-sm ${row.readAt ? "text-muted-foreground/80" : "text-foreground/80"}`}>{t(`kinds.${key}.body`, params)}</p> : null}
                <time className="text-xs text-muted-foreground" dateTime={row.createdAt.toISOString()}>
                  {format.relativeTime(row.createdAt, now)}
                </time>
              </div>
              {row.link || !row.readAt ? <OpenNotificationButton id={row.id} link={row.link} unread={!row.readAt} label={row.link ? t("open") : t("markRead")} /> : null}
            </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <nav className="flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/notifications?page=${page - 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("previous")}
            </Link>
          ) : null}
          <span className="text-muted-foreground">{t("page", { page, pageCount })}</span>
          {page < pageCount ? (
            <Link href={`/notifications?page=${page + 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}

      <PushToggle vapidPublicKey={vapidPublicKey()} personId={user.person.id} deviceCount={devices.length} />
      <MessengerLink
        configured={messengerConfig() !== null}
        status={{
          link: messenger.link ? { linkedAt: messenger.link.linkedAt.toISOString(), lastSuccessAt: messenger.link.lastSuccessAt?.toISOString() ?? null } : null,
          pending: messenger.pending ? { expiresAt: messenger.pending.expiresAt.toISOString(), codeSent: messenger.pending.codeSent } : null,
        }}
      />
      <PreferencesForm preferences={preferences} />
    </div>
  );
}
