// The cover plan beside a leave request (FR-PJM-44): the approver sees who covers what before
// deciding, and the person whose leave it is finds the way to their plan. Read-only, a server
// component; the leave page has already decided the viewer may read the request. The work is named
// only where the viewer may open it — a private project's task reads as "private work". Where
// there is no plan the panel says why (the leave is too short to ask for one, or the draft has not
// been made yet) instead of leaving the approver to wonder.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { RecordLink } from "@/components/ui/record-link";
import { statusTone } from "@/components/ui/tone";
import { getLeaveCoverAs } from "../service";

export async function CoverPlanPanel({ leaveRequestId, viewerPersonId }: { leaveRequestId: string; viewerPersonId: string }) {
  const cover = await getLeaveCoverAs(leaveRequestId, viewerPersonId);
  if (!cover) return null;
  const t = await getTranslations("work.cover");
  if (!cover.plan) {
    return (
      <section className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
        <h2 className="font-medium">{t("panelTitle")}</h2>
        <p className="text-muted-foreground">{cover.reason === "too_short" ? t("panelTooShort", { days: cover.minDays }) : t("panelNotDrafted")}</p>
      </section>
    );
  }
  const { plan } = cover;
  const format = await getFormatter();
  const moving = plan.items.filter((item) => item.itemType !== "booking");
  const covered = moving.filter((item) => item.effectiveCoverName).length;
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t("panelTitle")}</h2>
        <Badge dot variant={statusTone(plan.status)}>{t(`statuses.${plan.status}`)}</Badge>
        {plan.status !== "cancelled" && moving.length > 0 ? <span className="text-muted-foreground">{t("coveredCount", { covered, total: moving.length })}</span> : null}
        {/* The person, a cover named in it, whoever may submit it for them: the people its page opens for. */}
        {cover.canOpen && plan.status !== "cancelled" ? (
          <Link href={`/work/cover/${plan.id}`} className="ml-auto underline">
            {plan.status === "draft" && plan.personId === viewerPersonId ? t("fill") : t("open")}
          </Link>
        ) : null}
      </div>
      {plan.status === "cancelled" ? (
        <p className="text-muted-foreground">{t("panelCancelled")}</p>
      ) : plan.items.length ? (
        <>
          {plan.status === "draft" && moving.length > covered ? <p className="text-warning">{t("panelDraft", { name: plan.personName })}</p> : null}
          <ul className="flex flex-col gap-1">
            {plan.items.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{t(`types.${item.itemType}`)}:</span>
                <span className={item.label === null ? "text-muted-foreground italic" : undefined}>{item.label ?? t("privateItem")}</span>
                <span className="text-muted-foreground">→ {item.itemType === "booking" ? t("bookingInfo") : item.effectiveCoverName ? <RecordLink kind="person" id={item.coverPersonId ?? plan.defaultCoverPersonId}>{item.effectiveCoverName}</RecordLink> : t("uncovered")}</span>
                {item.acknowledgedAt ? <span className="text-xs text-muted-foreground">({t("acknowledgedOn", { date: format.dateTime(item.acknowledgedAt, { dateStyle: "short" }) })})</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground">{t("nothing")}</p>
      )}
    </section>
  );
}
