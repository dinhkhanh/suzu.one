// The cover plan beside a leave request (FR-PJM-44): the approver sees who covers what before
// deciding, and the person whose leave it is finds the way to their plan. Read-only, a server
// component; the leave page has already decided the viewer may read the request. The work is named
// only where the viewer may open it — a private project's task reads as "private work". Where
// there is no plan the panel says why (the leave is too short to ask for one, or the draft has not
// been made yet) instead of leaving the approver to wonder.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { getLeaveCoverAs } from "../service";

export async function CoverPlanPanel({ leaveRequestId, viewerPersonId }: { leaveRequestId: string; viewerPersonId: string }) {
  const cover = await getLeaveCoverAs(leaveRequestId, viewerPersonId);
  if (!cover) return null;
  const t = await getTranslations("work.cover");
  if (!cover.plan) {
    return (
      <TableCard>
        <TableCardHeader title={t("panelTitle")} />
        <List>
          <ListEmpty>{cover.reason === "too_short" ? t("panelTooShort", { days: cover.minDays }) : t("panelNotDrafted")}</ListEmpty>
        </List>
      </TableCard>
    );
  }
  const { plan } = cover;
  const format = await getFormatter();
  const moving = plan.items.filter((item) => item.itemType !== "booking");
  const covered = moving.filter((item) => item.effectiveCoverName).length;
  return (
    <TableCard>
      <TableCardHeader
        title={t("panelTitle")}
        description={plan.status !== "cancelled" && moving.length > 0 ? t("coveredCount", { covered, total: moving.length }) : undefined}
        actions={
          <>
            <Badge dot variant={statusTone(plan.status)}>
              {t(`statuses.${plan.status}`)}
            </Badge>
            {/* The person, a cover named in it, whoever may submit it for them: the people its page opens for. */}
            {cover.canOpen && plan.status !== "cancelled" ? (
              <Link href={`/work/cover/${plan.id}`} className="text-sm text-link hover:underline">
                {plan.status === "draft" && plan.personId === viewerPersonId ? t("fill") : t("open")}
              </Link>
            ) : null}
          </>
        }
      />
      {plan.status === "draft" && plan.items.length > 0 && moving.length > covered ? <p className="border-b px-4 py-2 text-sm text-warning">{t("panelDraft", { name: plan.personName })}</p> : null}
      <List>
        {plan.status === "cancelled" ? <ListEmpty>{t("panelCancelled")}</ListEmpty> : plan.items.length === 0 ? <ListEmpty>{t("nothing")}</ListEmpty> : null}
        {plan.status === "cancelled"
          ? null
          : plan.items.map((item) => (
              <ListItem key={item.id} className="flex-wrap gap-x-2">
                <span className="text-muted-foreground">{t(`types.${item.itemType}`)}:</span>
                <span className={item.label === null ? "text-muted-foreground italic" : undefined}>{item.label ?? t("privateItem")}</span>
                <span className="text-muted-foreground">
                  →{" "}
                  {item.itemType === "booking" ? (
                    t("bookingInfo")
                  ) : item.effectiveCoverName ? (
                    <RecordLink kind="person" id={item.coverPersonId ?? plan.defaultCoverPersonId}>
                      {item.effectiveCoverName}
                    </RecordLink>
                  ) : (
                    t("uncovered")
                  )}
                </span>
                {item.acknowledgedAt ? <span className="text-xs text-muted-foreground">({t("acknowledgedOn", { date: format.dateTime(item.acknowledgedAt, { dateStyle: "short" }) })})</span> : null}
              </ListItem>
            ))}
      </List>
    </TableCard>
  );
}
