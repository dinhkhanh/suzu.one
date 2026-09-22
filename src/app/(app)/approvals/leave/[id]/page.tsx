import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { decideLeaveAction } from "@/modules/leave/actions";
import { canManageLeaveOf } from "@/modules/leave/policy";
import { getLeaveRequestView } from "@/modules/leave/requests";
import { AttachmentButton, CancelLeaveButton } from "@/modules/leave/ui/request-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { CoverPlanPanel } from "@/modules/work/ui/cover-panel";

export const metadata: Metadata = { title: "Leave request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeaveRequestPage(props: PageProps<"/approvals/leave/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getLeaveRequestView({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const t = await getTranslations("leave");
  const format = await getFormatter();
  const locale = await getLocale();
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
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{locale === "en" && type.nameEn ? type.nameEn : type.name}</h1>
          <RequestStatusBadge status={status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.subjectName}
          {view.requesterName !== view.subjectName ? ` · ${t("request.filedBy", { name: view.requesterName })}` : ""}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("request.dates")}</dt>
          <dd className="text-sm">{leaveRequest.startDate === leaveRequest.endDate ? date(leaveRequest.startDate) : `${date(leaveRequest.startDate)} – ${date(leaveRequest.endDate)}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("request.cost")}</dt>
          <dd className="text-sm">{t("daysCount", { days: days(leaveRequest.totalCenti) })}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{t("request.countedDays")}</dt>
          <dd className="text-sm">{view.days.map((day) => `${format.dateTime(new Date(`${day.date}T00:00:00`), { day: "numeric", month: "numeric" })}${day.portion === "full" ? "" : ` (${t(`portions.${day.portion}`)})`}`).join(" · ")}</dd>
        </div>
        {view.balance ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("request.balanceNow")}</dt>
            <dd className="text-sm">
              {days(view.balance.balanceCenti)}
              {view.balance.pendingCenti ? ` (${t("balances.pending", { days: days(view.balance.pendingCenti) })})` : ""}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{t("request.reason")}</dt>
          <dd className="text-sm">{leaveRequest.reason ?? "—"}</dd>
        </div>
        {leaveRequest.attachmentFileId ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("request.attachment")}</dt>
            <dd>
              <AttachmentButton requestId={request.id} label={t("request.openAttachment")} />
            </dd>
          </div>
        ) : null}
      </dl>

      {view.conflicts.colleaguesAway.length > 0 || view.conflicts.shortfalls.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <h2 className="font-medium">{t("request.colleaguesAway")}</h2>
          <ul className="list-disc pl-5 text-muted-foreground">
            {view.conflicts.colleaguesAway.map((row) => (
              <li key={row.name}>
                {row.name}: {row.dates.map((value) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric" })).join(", ")}
              </li>
            ))}
          </ul>
          {view.conflicts.shortfalls.length > 0 ? (
            <p className="rounded-lg bg-muted p-2">
              {t("request.shortfall", { dates: view.conflicts.shortfalls.map((row) => format.dateTime(new Date(`${row.date}T00:00:00`), { day: "numeric", month: "numeric" })).join(", "), min: view.conflicts.shortfalls[0].minPresent })}
            </p>
          ) : null}
        </section>
      ) : null}

      <CoverPlanPanel leaveRequestId={leaveRequest.id} viewerPersonId={user.person.id} />
      {view.canDecide && leaveRequest.status === "pending" ? <DecisionForm requestId={request.id} action={decideLeaveAction} /> : null}
      {canCancel ? (
        <div className="flex flex-wrap items-center gap-2">
          {mine || isHr ? (
            <Link href={`/leave/new?amends=${leaveRequest.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("request.amend")}
            </Link>
          ) : null}
          <CancelLeaveButton leaveRequestId={leaveRequest.id} label={leaveRequest.status === "pending" ? t("request.withdraw") : t("request.cancel")} confirm={t("request.cancelConfirm")} askReason={leaveRequest.status === "approved"} />
        </div>
      ) : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestHistory view={view} />
    </div>
  );
}
