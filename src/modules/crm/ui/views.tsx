// Read-only pieces shared by the CRM's pages (server components): follow-ups with their forms,
// the activity feed, the timeline, and the money and date words every page uses.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import type { ActivityView } from "../activities";
import type { TimelineItem } from "../timeline";
import { CancelFollowUpButton, CompleteFollowUpForm, RescheduleForm } from "./activity-forms";
import type { Person } from "./common";

export async function formatters() {
  const format = await getFormatter();
  return {
    money: (value: number | null | undefined) => (value === null || value === undefined ? "—" : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 })),
    date: (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—"),
    when: (value: Date | string | null | undefined) => (value ? format.dateTime(typeof value === "string" ? new Date(value) : value, { dateStyle: "medium" }) : "—"),
    hours: (minutes: number) => format.number(Math.round((minutes / 60) * 10) / 10, { maximumFractionDigits: 1 }),
    percent: (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value}%`),
  };
}

/** Open follow-ups, soonest first, each with done / move / drop for whoever may change it. */
export async function FollowUpList({ items, canEdit, people, meId, today, showTarget = true }: { items: ActivityView[]; canEdit: (item: ActivityView) => boolean; people: Person[]; meId: string; today: string; showTarget?: boolean }) {
  const [t, tEnums, f] = await Promise.all([getTranslations("crm.activity"), getTranslations("crm.enums"), formatters()]);
  return (
    <List>
      {items.length === 0 ? <ListEmpty>{t("noFollowUps")}</ListEmpty> : null}
      {items.map((item) => {
        const overdue = !!item.dueOn && item.dueOn < today;
        return (
          <ListItem key={item.id} className="block">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <Badge variant={overdue ? "destructive" : item.dueOn === today ? "warning" : "outline"}>{f.date(item.dueOn)}</Badge>
                <span className="font-medium">{item.subject}</span>
                <span className="text-xs text-muted-foreground">{tEnums(`activityKind.${item.kind as "call"}`)}</span>
                {showTarget ? <span className="text-xs text-muted-foreground">{[item.dealTitle, item.accountName ?? item.leadCompany].filter(Boolean).join(" · ")}</span> : null}
                <span className="text-xs text-muted-foreground">{item.ownerName}</span>
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                <p className="text-xs">
                  <Link href={item.dealId ? `/crm/deals/${item.dealId}` : item.leadId ? `/crm/leads/${item.leadId}` : `/crm/accounts/${item.clientId}`} className="underline">
                    {t("open")}
                  </Link>
                </p>
                {canEdit(item) ? (
                  <>
                    <CompleteFollowUpForm activityId={item.id} people={people} meId={meId} today={today} />
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("reschedule")}</summary>
                      <div className="pt-2">
                        <RescheduleForm activityId={item.id} subject={item.subject} dueOn={item.dueOn ?? today} ownerPersonId={item.ownerPersonId} people={people} />
                      </div>
                    </details>
                    <CancelFollowUpButton activityId={item.id} />
                  </>
                ) : null}
              </div>
            </details>
          </ListItem>
        );
      })}
    </List>
  );
}

/** Logged activities, newest first. */
export async function ActivityList({ items }: { items: ActivityView[] }) {
  const [t, tEnums, f] = await Promise.all([getTranslations("crm.activity"), getTranslations("crm.enums"), formatters()]);
  return (
    <List>
      {items.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
      {items.map((item) => (
        <ListItem key={item.id} className="block">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{tEnums(`activityKind.${item.kind as "call"}`)}</Badge>
            <span className="font-medium">{item.subject}</span>
            <span className="text-xs text-muted-foreground">
              {f.when(item.occurredAt ?? item.doneAt)} · <RecordLink kind="person" id={item.ownerPersonId}>{item.ownerName}</RecordLink>
              {item.contactName ? ` · ${item.contactName}` : ""}
            </span>
          </p>
          <RichText text={item.body} className="mt-1 text-muted-foreground" />
          {item.outcome ? <p className="mt-1">{t("outcomeIs", { outcome: item.outcome })}</p> : null}
        </ListItem>
      ))}
    </List>
  );
}

const DETAIL_KEYS: Partial<Record<TimelineItem["kind"], string>> = { client_decision: "decision", status_update: "health", deal_lost: "lostReason", quote_sent: "quoteStatus" };

/** The account's (or deal's) history from every module, newest first, each item linking to its record. */
export async function Timeline({ items }: { items: TimelineItem[] }) {
  const [t, tEnums, f] = await Promise.all([getTranslations("crm.timeline"), getTranslations("crm.enums"), formatters()]);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  const detail = (item: TimelineItem): string | null => {
    if (!item.detail) return null;
    const group = DETAIL_KEYS[item.kind];
    if (group && tEnums.has(`${group}.${item.detail}` as "decision.approved")) return tEnums(`${group}.${item.detail}` as "decision.approved");
    if (item.kind === "activity" && tEnums.has(`activityKind.${item.detail}` as "activityKind.call")) return tEnums(`activityKind.${item.detail}` as "activityKind.call");
    return item.detail;
  };
  return (
    <ol className="flex flex-col gap-2 border-l pl-4">
      {items.map((item) => (
        <li key={item.key} className="relative text-sm">
          <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-muted-foreground/60" aria-hidden />
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{f.when(item.at)}</span>
            <Badge variant="outline">{t(`kinds.${item.kind}`)}</Badge>
            {item.link ? (
              <Link href={item.link} className="font-medium underline-offset-2 hover:underline">
                {item.title}
              </Link>
            ) : (
              <span className="font-medium">{item.title}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              detail(item),
              item.projectName ? (
                <RecordLink key="project" kind="project" id={item.projectId}>
                  {item.projectName}
                </RecordLink>
              ) : null,
              item.actorName ? (
                <RecordLink key="actor" kind="person" id={item.actorId}>
                  {item.actorName}
                </RecordLink>
              ) : null,
            ]
              .filter(Boolean)
              .flatMap((part, index) => (index ? [" · ", part] : [part]))}
          </p>
        </li>
      ))}
    </ol>
  );
}
