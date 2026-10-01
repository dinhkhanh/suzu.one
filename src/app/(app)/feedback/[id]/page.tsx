import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Fact, FactSheet } from "@/modules/core-hr/ui/fact-sheet";
import { canOpenFeedbackInbox, canReadFeedback, canTriageFeedback } from "@/modules/feedback/policy";
import { getFeedback } from "@/modules/feedback/service";
import { PriorityBadge, StatusBadge } from "@/modules/feedback/ui/feedback-list";
import { CATEGORY_ICONS } from "@/modules/feedback/ui/icons";
import { ScreenshotLink, TriageForm } from "@/modules/feedback/ui/triage-form";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
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
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href={staff && !own ? "/feedback/inbox" : "/feedback"} className="hover:underline">
            {staff && !own ? t("detail.backInbox") : t("detail.backMine")}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <Icon className="size-5 text-muted-foreground" aria-hidden />
            {t(`categories.${row.category}`)}
          </span>
        }
        description={`${t("detail.sentBy", { name: own ? t("detail.you") : view.personName, when: when(row.createdAt) })}${staff && !own && view.personEmail ? ` · ${view.personEmail}` : ""}`}
      >
        <div className="flex flex-wrap gap-1.5 pt-1">
          <StatusBadge status={row.status} label={t(`statuses.${row.status}`)} />
          {staff ? <PriorityBadge priority={row.priority} label={t(`priorities.${row.priority}`)} /> : null}
          {row.blocking ? <Badge variant="destructive">{t("list.blocking")}</Badge> : null}
        </div>
      </PageHeader>

      <Card>
        <CardContent className="break-words">
          <RichText text={row.message} />
        </CardContent>
      </Card>

      <FactSheet>
        {row.pagePath ? (
          <Fact label={t("detail.page")}>
            <span className="font-mono text-xs break-all">
              {staff ? (
                <Link href={row.pagePath} className="text-link hover:underline">
                  {row.pagePath}
                </Link>
              ) : (
                row.pagePath
              )}
            </span>
          </Fact>
        ) : null}
        {row.screenshotFileId && view.screenshotName && (own || triage) ? (
          <Fact label={t("detail.screenshot")}>
            <ScreenshotLink feedbackId={row.id} fileId={row.screenshotFileId} fileName={view.screenshotName} />
          </Fact>
        ) : null}
        {staff && row.userAgent ? (
          <Fact label={t("detail.device")}>
            <span className="text-xs break-words text-muted-foreground">{row.userAgent}</span>
          </Fact>
        ) : null}
        {view.handlerName && staff ? <Fact label={t("detail.handledBy")}>{t("detail.handledAt", { name: view.handlerName, when: when(row.updatedAt) })}</Fact> : null}
      </FactSheet>

      {triage ? (
        <Section title={t("triage.title")}>
          <Card>
            <CardHeader>
              <CardDescription>{t("triage.help")}</CardDescription>
            </CardHeader>
            <CardContent>
              <TriageForm id={row.id} status={row.status} priority={row.priority} reply={row.reply} internalNote={row.internalNote} />
            </CardContent>
          </Card>
        </Section>
      ) : (
        <>
          <Section title={t("detail.reply")}>
            {row.reply ? (
              <Card className="bg-primary/3 ring-1 ring-primary/30">
                <CardContent className="break-words">
                  <RichText text={row.reply} />
                  {row.repliedAt ? <p className="mt-2 text-xs text-faint">{when(row.repliedAt)}</p> : null}
                </CardContent>
              </Card>
            ) : (
              <Alert>{t("detail.noReply")}</Alert>
            )}
          </Section>
          {staff && row.internalNote ? (
            <Section title={t("triage.internalNote")}>
              <Card>
                <CardHeader>
                  <CardTitle className="sr-only">{t("triage.internalNote")}</CardTitle>
                </CardHeader>
                <CardContent className="break-words">
                  <RichText text={row.internalNote} />
                </CardContent>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Page>
  );
}
