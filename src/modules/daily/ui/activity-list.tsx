// A report's lines — done, not done, the day's activity — for the form and the read-only view.
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ActivityItem, DailyTaskLine } from "../schema";
import { hoursOf } from "./format";

const ACTIVITY_KINDS = ["created", "moved", "completed", "submitted", "reviewed", "commented", "handoff_sent", "handoff_received", "blocker_raised", "blocker_resolved", "time_logged"] as const;

export function TaskLines({ lines, empty }: { lines: readonly DailyTaskLine[]; empty: string }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lines.map((line) => (
        <li key={line.taskId}>
          <Link href={`/work/tasks/${line.taskId}`} className="hover:underline">
            {line.ref ? <span className="font-mono text-xs text-muted-foreground">{line.ref}</span> : null} {line.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ActivityList({ items }: { items: readonly ActivityItem[] }) {
  const t = useTranslations("daily.activity");
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((item, index) => {
        const kind = (ACTIVITY_KINDS as readonly string[]).includes(item.kind) ? (item.kind as (typeof ACTIVITY_KINDS)[number]) : null;
        const title = item.taskId ? (
          <Link href={`/work/tasks/${item.taskId}`} className="hover:underline">
            {item.ref ? <span className="font-mono text-xs text-muted-foreground">{item.ref}</span> : null} {item.title}
          </Link>
        ) : (
          <span>{t.has(`categories.${item.title}`) ? t(`categories.${item.title}` as "categories.admin") : item.title}</span>
        );
        const detail = kind === "time_logged" ? t("hours", { value: hoursOf(Number(item.detail ?? 0)) }) : kind === "commented" ? t("comments", { count: Number(item.detail ?? 1) }) : kind === "reviewed" && item.detail ? t(`decisions.${item.detail === "approved" ? "approved" : "changes_requested"}`) : item.detail;
        return (
          <li key={`${item.kind}:${item.taskId ?? item.title}:${index}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium text-muted-foreground">{kind ? t(`kinds.${kind}`) : item.kind}</span>
            {title}
            {detail ? <span className="text-xs text-muted-foreground">· {detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
