// The cover plan beside a leave request (FR-PJM-44): the approver sees who covers what before
// deciding. Read-only, a server component; the leave page has already decided the viewer may read
// the request. The work is named only where the approver may open it — a private project's task
// reads as "private work".
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getCoverPlanForLeaveAs } from "../service";

export async function CoverPlanPanel({ leaveRequestId, viewerPersonId }: { leaveRequestId: string; viewerPersonId: string }) {
  const plan = await getCoverPlanForLeaveAs(leaveRequestId, viewerPersonId);
  if (!plan || plan.status === "cancelled") return null;
  const t = await getTranslations("work.cover");
  const format = await getFormatter();
  const moving = plan.items.filter((item) => item.itemType !== "booking");
  const covered = moving.filter((item) => item.effectiveCoverName).length;
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t("panelTitle")}</h2>
        <Badge variant={plan.status === "submitted" ? "default" : plan.status === "draft" ? "secondary" : "outline"}>{t(`statuses.${plan.status}`)}</Badge>
        <span className="text-muted-foreground">{t("coveredCount", { covered, total: moving.length })}</span>
        {plan.personId === viewerPersonId ? (
          <Link href={`/work/cover/${plan.id}`} className="ml-auto underline">
            {plan.status === "draft" ? t("fill") : t("open")}
          </Link>
        ) : null}
      </div>
      {plan.items.length ? (
        <ul className="flex flex-col gap-1">
          {plan.items.map((item) => (
            <li key={item.id} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">{t(`types.${item.itemType}`)}:</span>
              <span className={item.label === null ? "text-muted-foreground italic" : undefined}>{item.label ?? t("privateItem")}</span>
              <span className="text-muted-foreground">→ {item.itemType === "booking" ? t("bookingInfo") : (item.effectiveCoverName ?? t("uncovered"))}</span>
              {item.acknowledgedAt ? <span className="text-xs text-muted-foreground">({t("acknowledgedOn", { date: format.dateTime(item.acknowledgedAt, { dateStyle: "short" }) })})</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t("nothing")}</p>
      )}
    </section>
  );
}
