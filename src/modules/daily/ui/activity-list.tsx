// A report's lines — done, not done, the day's activity — for the form and the read-only view.
import { useTranslations } from "next-intl";
import { RecordLink } from "@/components/ui/record-link";
import type { ShownActivity, ShownLine } from "../engine/redact";
import { hoursOf } from "./format";

// `client_activity` and `deal_moved` come from the CRM, through the platform's day-activity registry (FR-CRM-43).
const ACTIVITY_KINDS = ["created", "moved", "completed", "submitted", "reviewed", "commented", "handoff_sent", "handoff_received", "blocker_raised", "blocker_resolved", "time_logged", "client_activity", "deal_moved"] as const;

/** `hidden` lines are work on something this reader may not open: said, never named (SRS §4.6b). */
export function TaskLines({ lines, empty }: { lines: readonly ShownLine[]; empty: string }) {
  const t = useTranslations("daily");
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lines.map((line) => (
        <li key={line.taskId}>
          {line.hidden ? (
            <span className="text-muted-foreground italic">{t("privateWork")}</span>
          ) : (
            <RecordLink kind="task" id={line.taskId}>
              {line.ref ? <span className="font-mono text-xs text-muted-foreground">{line.ref}</span> : null} {line.title}
            </RecordLink>
          )}
        </li>
      ))}
    </ul>
  );
}

/** `past`: the list is of a day before today — the empty line says so instead of "today … yet". */
export function ActivityList({ items, past = false }: { items: readonly ShownActivity[]; past?: boolean }) {
  const t = useTranslations("daily.activity");
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t(past ? "emptyPast" : "empty")}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((item, index) => {
        const kind = (ACTIVITY_KINDS as readonly string[]).includes(item.kind) ? (item.kind as (typeof ACTIVITY_KINDS)[number]) : null;
        const title = item.hidden ? (
          <span className="text-muted-foreground italic">{t("privateWork")}</span>
        ) : item.taskId ? (
          <RecordLink kind="task" id={item.taskId}>
            {item.ref ? <span className="font-mono text-xs text-muted-foreground">{item.ref}</span> : null} {item.title}
          </RecordLink>
        ) : (
          <span>{t.has(`categories.${item.title}`) ? t(`categories.${item.title}` as "categories.admin") : item.title}</span>
        );
        const detail =
          kind === "time_logged"
            ? t("hours", { value: hoursOf(Number(item.detail ?? 0)) })
            : kind === "commented"
              ? t("comments", { count: Number(item.detail ?? 1) })
              : kind === "reviewed" && item.detail
                ? t(`decisions.${item.detail === "approved" ? "approved" : "changes_requested"}`)
                : item.detail;
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
