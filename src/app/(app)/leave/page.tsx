import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { getBalances } from "@/modules/leave/ledger";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { listLeaveRequestsOf } from "@/modules/leave/requests";
import { CancelLeaveButton } from "@/modules/leave/ui/request-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Leave" };

const STATUS_VARIANT = { pending: "secondary", approved: "default", rejected: "outline", withdrawn: "outline", cancelled: "outline" } as const;

// The signed-in person's leave: what is left, what was asked for, and the way to ask for more.
export default async function LeavePage() {
  const user = await requireUser();
  const t = await getTranslations("leave");
  const format = await getFormatter();
  const locale = await getLocale();
  const today = todayInVietnam();
  const year = Number(today.slice(0, 4));
  const [balances, requests] = await Promise.all([getBalances([user.person.id], year), listLeaveRequestsOf(user.person.id)]);
  const mine = balances.get(user.person.id) ?? [];
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric", year: "numeric" });

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/leave/calendar" className="underline-offset-4 hover:underline">
            {t("calendar.title")}
          </Link>
          {canOpenLeaveAdmin(user.principal) ? (
            <Link href="/leave/admin/balances" className="underline-offset-4 hover:underline">
              {t("admin.title")}
            </Link>
          ) : null}
          <Link href="/leave/new" className={buttonVariants()}>
            {t("request.new")}
          </Link>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("balances.title", { year })}</h2>
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("balances.none")}</p> : null}
        <ul className="grid gap-3 sm:grid-cols-3">
          {mine.map((row) => (
            <li key={row.leaveTypeId} className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">{locale === "en" && row.nameEn ? row.nameEn : row.name}</p>
              <p className="text-2xl font-semibold tabular-nums">{days(row.availableCenti)}</p>
              <p className="text-xs text-muted-foreground">
                {t("balances.used", { days: days(row.usedCenti) })}
                {row.pendingCenti ? ` · ${t("balances.pending", { days: days(row.pendingCenti) })}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("request.mine")}</h2>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">{t("request.none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {requests.map((request) => {
            const open = request.status === "pending" || (request.status === "approved" && request.startDate > today);
            return (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {request.approvalRequestId ? (
                      <Link href={`/approvals/leave/${request.approvalRequestId}`} className="hover:underline">
                        {request.typeName}
                      </Link>
                    ) : (
                      request.typeName
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {request.startDate === request.endDate ? date(request.startDate) : `${date(request.startDate)} – ${date(request.endDate)}`} · {t("daysCount", { days: days(request.totalCenti) })}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[request.status]}>{t(`status.${request.status === "pending" && request.approvalStatus === "returned" ? "returned" : request.status}`)}</Badge>
                {open ? (
                  <div className="flex items-center gap-2">
                    <Link href={`/leave/new?amends=${request.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t("request.amend")}
                    </Link>
                    <CancelLeaveButton leaveRequestId={request.id} label={request.status === "pending" ? t("request.withdraw") : t("request.cancel")} confirm={t("request.cancelConfirm")} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
