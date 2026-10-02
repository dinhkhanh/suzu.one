"use client";
// The inbox with tick boxes (FR-PLT-22: bulk approve). Only requests whose type says they may be
// approved unopened can be ticked; the action answers per request, so one refusal stops nothing.
// A table on a desk; on a phone the same rows are a list, the tick box at the left of each.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import type { ActionResult } from "@/lib/action";
import { ageOf } from "./age";
import { PersonName } from "./person-name";

export type BulkInboxRow = { id: string; type: string; summary: string; link: string | null; createdAt: Date; requesterPersonId: string; requesterName: string; bulk: boolean };
export type BulkResult = { requestId: string; ok: boolean; error?: string };

export function BulkInbox({ rows, action, labels = {} }: { rows: BulkInboxRow[]; action: (input: unknown) => Promise<ActionResult<{ results: BulkResult[] }>>; /** Names of the request builder's types, which the message bundle does not know. */ labels?: Record<string, string> }) {
  const t = useTranslations("approvals");
  const format = useFormatter();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, BulkResult>>({});
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const tickable = rows.filter((row) => row.bulk).map((row) => row.id);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  const label = (type: string) => labels[type] ?? (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type);
  const age = (createdAt: Date) => {
    const value = ageOf(createdAt);
    return { text: value.days >= 1 ? t("age.days", { days: value.days }) : t("age.hours", { hours: value.hours }), stale: value.stale };
  };

  function approveSelected() {
    if (selected.length === 0 || !window.confirm(t("bulk.confirm", { count: selected.length }))) return;
    startTransition(async () => {
      const result = await action({ requestIds: selected });
      setFailed(!result.ok);
      if (result.ok) {
        setResults(Object.fromEntries(result.data.results.map((row) => [row.requestId, row])));
        setSelected([]);
      }
    });
  }

  const outcome = (row: BulkInboxRow) => {
    const result = results[row.id];
    if (result?.ok) return <Badge dot variant="success">{t("status.approved")}</Badge>;
    if (result && !result.ok)
      return (
        <Badge dot variant="destructive">
          {t.has(`errors.${result.error}`) ? t(`errors.${result.error}` as "errors.generic") : t("errors.generic")}
        </Badge>
      );
    return <Badge variant="info">{row.bulk ? t("step.yourTurn") : t("bulk.openIt")}</Badge>;
  };

  return (
    <div className="flex flex-col gap-3">
      {tickable.length > 0 ? (
        <div className="toolbar">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected(selected.length === tickable.length ? [] : tickable)}>
            {selected.length === tickable.length ? t("bulk.none") : t("bulk.all", { count: tickable.length })}
          </Button>
          <Button type="button" size="sm" disabled={pending || selected.length === 0} onClick={approveSelected}>
            {t("bulk.approve", { count: selected.length })}
          </Button>
          <span className="hidden text-xs text-faint md:inline">{t("bulk.hint")}</span>
        </div>
      ) : null}
      {failed ? <Alert variant="destructive">{t("errors.generic")}</Alert> : null}

      <Table containerClassName="hidden md:block">
        <TableHeader>
          <TableRow>
            <TableHead kind="check" className="w-px" />
            <TableHead kind="select">{t("columns.type")}</TableHead>
            <TableHead kind="text">{t("columns.request")}</TableHead>
            <TableHead kind="person">{t("columns.requester")}</TableHead>
            <TableHead kind="status">{t("columns.step")}</TableHead>
            <TableHead kind="time">{t("columns.age")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("inboxEmpty")}</TableEmpty> : null}
          {rows.map((row) => {
            const ticked = selected.includes(row.id);
            const waited = age(row.createdAt);
            return (
              <TableRow key={row.id} data-state={ticked ? "selected" : undefined}>
                <TableCell className="w-px pr-0">
                  <Checkbox aria-label={t("bulk.tick")} disabled={!row.bulk || pending} checked={ticked} onCheckedChange={() => toggle(row.id)} />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{label(row.type)}</Badge>
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <Link href={row.link ?? "/approvals"} className="font-medium hover:underline">
                    {row.summary || label(row.type)}
                  </Link>
                </TableCell>
                <TableCell>
                  <PersonName name={row.requesterName} personId={row.requesterPersonId} />
                </TableCell>
                <TableCell>{outcome(row)}</TableCell>
                <TableCell kind="time" className={cn(waited.stale ? "text-warning" : "text-muted-foreground")} title={format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}>
                  {waited.text}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <List className="md:hidden">
        {rows.length === 0 ? <ListEmpty>{t("inboxEmpty")}</ListEmpty> : null}
        {rows.map((row, index) => {
          const ticked = selected.includes(row.id);
          const waited = age(row.createdAt);
          return (
            <ListItem key={row.id} data-state={ticked ? "selected" : undefined} className="rise items-start" style={{ "--i": index } as CSSProperties}>
              <Checkbox className="mt-1" aria-label={t("bulk.tick")} disabled={!row.bulk || pending} checked={ticked} onCheckedChange={() => toggle(row.id)} />
              <Link href={row.link ?? "/approvals"} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{label(row.type)}</Badge>
                  <span className={cn("font-mono text-[0.8125rem] tabular-nums", waited.stale ? "text-warning" : "text-muted-foreground")}>{waited.text}</span>
                </span>
                <span className="line-clamp-2 text-sm font-medium">{row.summary || label(row.type)}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{row.requesterName}</span>
                  {outcome(row)}
                </span>
              </Link>
            </ListItem>
          );
        })}
      </List>
    </div>
  );
}
