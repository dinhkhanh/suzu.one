// A list of feedback items, for one's own page and the inbox. Server component.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { FeedbackPriority, FeedbackStatus } from "../enums";
import type { FeedbackListItem } from "../service";
import { CATEGORY_ICONS } from "./icons";

const STATUS_VARIANT: Record<FeedbackStatus, "info" | "warning" | "success" | "secondary"> = { new: "info", in_progress: "warning", resolved: "success", declined: "secondary" };

export function StatusBadge({ status, label }: { status: FeedbackStatus; label: string }) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}

export function PriorityBadge({ priority, label }: { priority: FeedbackPriority; label: string }) {
  if (priority === "normal") return null;
  return <Badge variant={priority === "urgent" ? "destructive" : priority === "high" ? "warning" : "outline"}>{label}</Badge>;
}

export async function FeedbackList({ items, showPerson, empty }: { items: FeedbackListItem[]; showPerson: boolean; empty: string }) {
  const [t, format] = await Promise.all([getTranslations("feedback"), getFormatter()]);
  if (items.length === 0) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {items.map((item) => {
        const Icon = CATEGORY_ICONS[item.category];
        return (
          <li key={item.id}>
            <Link href={`/feedback/${item.id}`} className="flex gap-3 px-4 py-3 hover:bg-muted/60">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t(`categories.${item.category}`)} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-sm break-words">{item.message}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {showPerson ? <span className="font-medium text-foreground/80">{item.personName}</span> : null}
                  <span>{format.dateTime(item.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                  {item.area ? <span className="font-mono">/{item.area}</span> : null}
                  {item.reply && !showPerson ? <span className="text-primary">{t("list.replied")}</span> : null}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={item.status} label={t(`statuses.${item.status}`)} />
                {showPerson ? <PriorityBadge priority={item.priority} label={t(`priorities.${item.priority}`)} /> : null}
                {item.blocking ? <Badge variant="destructive">{t("list.blocking")}</Badge> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
