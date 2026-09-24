import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { canOpenFeedbackInbox, canReadFeedback, canTriageFeedback } from "@/modules/feedback/policy";
import { getFeedback } from "@/modules/feedback/service";
import { PriorityBadge, StatusBadge } from "@/modules/feedback/ui/feedback-list";
import { CATEGORY_ICONS } from "@/modules/feedback/ui/icons";
import { ScreenshotLink, TriageForm } from "@/modules/feedback/ui/triage-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("feedbackItem");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FeedbackItemPage({ params }: PageProps<"/feedback/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const view = await getFeedback(id);
  if (!view || !canReadFeedback(user.principal, view.target)) notFound();

  const [t, format] = await Promise.all([getTranslations("feedback"), getFormatter()]);
  const { row } = view;
  const own = row.personId === user.person.id;
  const triage = canTriageFeedback(user.principal, view.target);
  // The read-only inbox sees what was said; the screenshot and the note stay with triage.
  const staff = triage || (!own && canOpenFeedbackInbox(user.principal));
  const Icon = CATEGORY_ICONS[row.category];
  const when = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href={staff && !own ? "/feedback/inbox" : "/feedback"} className="text-sm text-muted-foreground hover:text-foreground">
        ← {staff && !own ? t("detail.backInbox") : t("detail.backMine")}
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
          <h1 className="text-lg">{t(`categories.${row.category}`)}</h1>
          <StatusBadge status={row.status} label={t(`statuses.${row.status}`)} />
          {staff ? <PriorityBadge priority={row.priority} label={t(`priorities.${row.priority}`)} /> : null}
          {row.blocking ? <Badge variant="destructive">{t("list.blocking")}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("detail.sentBy", { name: own ? t("detail.you") : view.personName, when: when(row.createdAt) })}
          {staff && !own && view.personEmail ? ` · ${view.personEmail}` : null}
        </p>
      </header>

      <section className="rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">{row.message}</section>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {row.pagePath ? (
          <>
            <dt className="text-muted-foreground">{t("detail.page")}</dt>
            <dd className="font-mono text-xs break-all">
              {staff ? (
                <Link href={row.pagePath} className="text-primary hover:underline">
                  {row.pagePath}
                </Link>
              ) : (
                row.pagePath
              )}
            </dd>
          </>
        ) : null}
        {row.screenshotFileId && view.screenshotName && (own || triage) ? (
          <>
            <dt className="text-muted-foreground">{t("detail.screenshot")}</dt>
            <dd>
              <ScreenshotLink feedbackId={row.id} fileId={row.screenshotFileId} fileName={view.screenshotName} />
            </dd>
          </>
        ) : null}
        {staff && row.userAgent ? (
          <>
            <dt className="text-muted-foreground">{t("detail.device")}</dt>
            <dd className="text-xs break-words text-muted-foreground">{row.userAgent}</dd>
          </>
        ) : null}
        {view.handlerName && staff ? (
          <>
            <dt className="text-muted-foreground">{t("detail.handledBy")}</dt>
            <dd>{t("detail.handledAt", { name: view.handlerName, when: when(row.updatedAt) })}</dd>
          </>
        ) : null}
      </dl>

      {triage ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-medium">{t("triage.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("triage.help")}</p>
          <TriageForm id={row.id} status={row.status} priority={row.priority} reply={row.reply} internalNote={row.internalNote} />
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("detail.reply")}</h2>
            {row.reply ? (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {row.reply}
                {row.repliedAt ? <p className="mt-2 text-xs text-muted-foreground">{when(row.repliedAt)}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("detail.noReply")}</p>
            )}
          </section>
          {staff && row.internalNote ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("triage.internalNote")}</h2>
              <p className="rounded-xl border p-4 text-sm whitespace-pre-wrap break-words">{row.internalNote}</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
