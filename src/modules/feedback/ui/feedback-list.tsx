// A list of feedback items, for one's own page and the inbox. Server component.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import type { FeedbackPriority, FeedbackStatus } from "../enums";
import type { FeedbackListItem } from "../service";
import { CATEGORY_ICONS } from "./icons";

export function StatusBadge({ status, label }: { status: FeedbackStatus; label: string }) {
  return <Badge dot variant={statusTone(status)}>{label}</Badge>;
}

export function PriorityBadge({ priority, label }: { priority: FeedbackPriority; label: string }) {
  if (priority === "normal") return null;
  return <Badge dot variant={priority === "urgent" ? "destructive" : priority === "high" ? "warning" : "outline"}>{label}</Badge>;
}

export async function FeedbackList({ items, showPerson, empty, numberFrom }: { items: FeedbackListItem[]; showPerson: boolean; empty: string; /** The number of the first row, for one page of many. */ numberFrom?: number }) {
  const [t, format] = await Promise.all([getTranslations("feedback"), getFormatter()]);
  return (
    <Table numberFrom={numberFrom}>
      <TableHeader>
        <TableRow>
          <TableHead kind="text">{t("list.message")}</TableHead>
          {showPerson ? <TableHead kind="person">{t("list.person")}</TableHead> : null}
          <TableHead kind="date">{t("list.sent")}</TableHead>
          <TableHead kind="id">{t("inbox.area")}</TableHead>
          <TableHead kind="status">{t("inbox.statusFilter")}</TableHead>
          {showPerson ? <TableHead kind="select">{t("list.priority")}</TableHead> : null}
          <TableHead kind="tags">{t("list.flags")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? <TableEmpty>{empty}</TableEmpty> : null}
        {items.map((item) => {
          const Icon = CATEGORY_ICONS[item.category];
          return (
            <TableRow key={item.id}>
              <TableCell className="max-w-md">
                <Link href={`/feedback/${item.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={t(`categories.${item.category}`)} />
                  <span className="truncate">{noteToPlainText(item.message)}</span>
                </Link>
              </TableCell>
              {showPerson ? <TableCell>{item.personName}</TableCell> : null}
              <TableCell>{format.dateTime(item.createdAt, { dateStyle: "short", timeStyle: "short" })}</TableCell>
              <TableCell kind="id">{item.area ? `/${item.area}` : "—"}</TableCell>
              <TableCell>
                <StatusBadge status={item.status} label={t(`statuses.${item.status}`)} />
              </TableCell>
              {showPerson ? <TableCell>{item.priority === "normal" ? "—" : <PriorityBadge priority={item.priority} label={t(`priorities.${item.priority}`)} />}</TableCell> : null}
              <TableCell>
                <span className="flex gap-1.5">
                  {item.blocking ? <Badge variant="destructive">{t("list.blocking")}</Badge> : null}
                  {item.reply && !showPerson ? <span className="text-primary">{t("list.replied")}</span> : null}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
