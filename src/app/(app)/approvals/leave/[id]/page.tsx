import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { decideLeaveAction } from "@/modules/leave/actions";
import { canManageLeaveOf } from "@/modules/leave/policy";
import { getLeaveRequestView } from "@/modules/leave/requests";
import { AttachmentButton, CancelLeaveButton } from "@/modules/leave/ui/request-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, PropertySheet, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { CoverPlanPanel } from "@/modules/work/ui/cover-panel";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("leaveRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeaveRequestPage(props: PageProps<"/approvals/leave/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getLeaveRequestView({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tApprovals, tRequests, format, locale] = await Promise.all([getTranslations("leave"), getTranslations("approvals"), getTranslations("requests"), getFormatter(), getLocale()]);
  const { request, leaveRequest, type } = view;
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" });
  const isHr = !!view.subject && canManageLeaveOf(user.principal, view.subject);
  const mine = leaveRequest.personId === user.person.id || leaveRequest.filedByPersonId === user.person.id;
  const started = leaveRequest.startDate <= todayInVietnam();
  // Pending: whoever filed it (or HR) ends it. Approved: the person until it starts, HR afterwards.
  const canCancel = leaveRequest.status === "pending" ? mine || isHr : leaveRequest.status === "approved" && (isHr || (mine && !started));
  const status = leaveRequest.status === "cancelled" ? "cancelled" : request.status;

  return (
    <Page width="narrow">
      <RequestHeader
        title={locale === "en" && type.nameEn ? type.nameEn : type.name}
        kind={tApprovals("types.leave")}
        status={status}
        requestId={request.id}
        who={
          <>
            <RecordLink kind="person" id={request.subjectPersonId}>
              {view.subjectName}
            </RecordLink>
            {view.requesterName !== view.subjectName ? (
              <>
                {" · "}
                {t.rich("request.filedBy", { name: view.requesterName, person: (chunks) => <RecordLink kind="person" id={request.requesterPersonId}>{chunks}</RecordLink> })}
              </>
            ) : null}
          </>
        }
        actions={
          canCancel ? (
            <>
              {mine || isHr ? (
                <Link href={`/leave/new?amends=${leaveRequest.id}`} className={buttonVariants({ variant: "outline" })}>
                  {t("request.amend")}
                </Link>
              ) : null}
              <CancelLeaveButton leaveRequestId={leaveRequest.id} label={leaveRequest.status === "pending" ? t("request.withdraw") : t("request.cancel")} confirm={t("request.cancelConfirm")} askReason={leaveRequest.status === "approved"} />
            </>
          ) : undefined
        }
      />

      <Section title={tRequests("view.details")}>
        <PropertySheet
          rows={[
            { label: t("request.dates"), value: leaveRequest.startDate === leaveRequest.endDate ? date(leaveRequest.startDate) : `${date(leaveRequest.startDate)} – ${date(leaveRequest.endDate)}` },
            { label: t("request.cost"), value: t("daysCount", { days: days(leaveRequest.totalCenti) }), money: true },
            { label: t("request.countedDays"), value: view.days.map((day) => `${format.dateTime(new Date(`${day.date}T00:00:00`), { day: "numeric", month: "numeric" })}${day.portion === "full" ? "" : ` (${t(`portions.${day.portion}`)})`}`).join(" · "), long: true },
            ...(view.balance ? [{ label: t("request.balanceNow"), value: `${days(view.balance.balanceCenti)}${view.balance.pendingCenti ? ` (${t("balances.pending", { days: days(view.balance.pendingCenti) })})` : ""}`, money: true }] : []),
            { label: t("request.reason"), value: leaveRequest.reason, long: true },
            ...(leaveRequest.attachmentFileId ? [{ label: t("request.attachment"), value: <AttachmentButton requestId={request.id} label={t("request.openAttachment")} /> }] : []),
          ]}
        />
      </Section>

      {view.conflicts.colleaguesAway.length > 0 || view.conflicts.shortfalls.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("request.colleaguesAway")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <ul className="text-muted-foreground">
              {view.conflicts.colleaguesAway.map((row) => (
                <li key={row.personId}>
                  <RecordLink kind="person" id={row.personId}>{row.name}</RecordLink>: <span className="font-mono text-xs tabular-nums">{row.dates.map((value) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric" })).join(", ")}</span>
                </li>
              ))}
            </ul>
            {view.conflicts.shortfalls.length > 0 ? <Alert variant="warning">{t("request.shortfall", { dates: view.conflicts.shortfalls.map((row) => format.dateTime(new Date(`${row.date}T00:00:00`), { day: "numeric", month: "numeric" })).join(", "), min: view.conflicts.shortfalls[0].minPresent })}</Alert> : null}
          </CardContent>
        </Card>
      ) : null}

      <CoverPlanPanel leaveRequestId={leaveRequest.id} viewerPersonId={user.person.id} />
      <ApprovalChain view={view} />
      {view.canDecide && leaveRequest.status === "pending" ? <DecisionForm requestId={request.id} action={decideLeaveAction} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
