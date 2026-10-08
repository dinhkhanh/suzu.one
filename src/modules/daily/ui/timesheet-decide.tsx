"use client";
// The approver's side of the weekly timesheet (FR-PJM-25): approve, return with a comment, reopen
// an approved week with a reason, and approve several at once from the waiting list.
import { Check, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { bulkApproveWeeksAction, decideWeekAction, reopenWeekAction } from "../time-actions";
import { RunNotice } from "./run-notice";
import { useRun } from "./use-run";

export function DecideWeek({ weekId, status }: { weekId: string; status: string }) {
  const t = useTranslations("daily.timesheets");
  const { run, pending, errorKey } = useRun();
  const [mode, setMode] = useState<"return" | "reopen" | null>(null);
  const [text, setText] = useState("");
  if (status !== "submitted" && status !== "approved") return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
          {status === "submitted" ? (
            <>
              {/* Approving is what the approver opened this week for: the one accent key. */}
              <Button type="button" variant="accent" disabled={pending} onClick={() => run(decideWeekAction, { id: weekId, decision: "approve" })}>
                <Check aria-hidden /> {t("approve")}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setMode(mode === "return" ? null : "return")}>
                <Undo2 aria-hidden /> {t("return")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={() => setMode(mode === "reopen" ? null : "reopen")}>
              <RotateCcw aria-hidden /> {t("reopen")}
            </Button>
          )}
        </div>
        {mode ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!text.trim()) return;
              run(mode === "return" ? decideWeekAction : reopenWeekAction, mode === "return" ? { id: weekId, decision: "return", comment: text } : { id: weekId, reason: text }, () => {
                setMode(null);
                setText("");
              });
            }}
          >
            <Label htmlFor="decision-text">{mode === "return" ? t("returnComment") : t("reopenReason")}</Label>
            <Textarea id="decision-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required placeholder={mode === "return" ? t("returnPlaceholder") : t("reopenPlaceholder")} />
            <Button type="submit" size="sm" variant={mode === "return" ? "destructive" : "default"} disabled={pending || !text.trim()} className="self-start">
              {mode === "return" ? t("confirmReturn") : t("confirmReopen")}
            </Button>
          </form>
        ) : null}
        <FormError namespace="daily.errors" errorKey={errorKey} />
      </CardContent>
    </Card>
  );
}

export type WaitingRow = { id: string; href: string; name: string; week: string; hours: string; submitted: string | null };

/** Weeks waiting for the approver: open one to read it, or tick several and approve them together. */
export function WaitingList({ rows }: { rows: WaitingRow[] }) {
  const t = useTranslations("daily.timesheets");
  const { run, pending, errorKey, notice, dismiss } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const all = rows.length > 0 && picked.length === rows.length;
  return (
    <TableCard>
      {rows.length > 0 ? (
        <div className="toolbar border-b px-4 py-2.5">
          <Button type="button" size="sm" disabled={pending || picked.length === 0} onClick={() => run(bulkApproveWeeksAction, { ids: picked }, () => setPicked([]))}>
            <Check aria-hidden /> {t("approveSelected", { count: picked.length })}
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">
              <span className="flex items-center gap-3">
                {rows.length > 0 ? <Checkbox aria-label={t("selectAll")} checked={all} onCheckedChange={() => setPicked(all ? [] : rows.map((row) => row.id))} /> : null}
                {t("columns.person")}
              </span>
            </TableHead>
            <TableHead kind="date">{t("columns.week")}</TableHead>
            <TableHead kind="date">{t("columns.submitted")}</TableHead>
            <TableHead kind="time">{t("columns.hours")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.id} data-state={picked.includes(row.id) ? "selected" : undefined}>
              <TableCell>
                <span className="flex items-center gap-3">
                  <Checkbox
                    aria-label={t("pick", { name: row.name, week: row.week })}
                    checked={picked.includes(row.id)}
                    onCheckedChange={(checked) => setPicked((current) => (checked ? [...current, row.id] : current.filter((id) => id !== row.id)))}
                  />
                  <Link href={row.href} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.week}</TableCell>
              <TableCell className="text-muted-foreground">{row.submitted ?? ""}</TableCell>
              <TableCell kind="time">{row.hours}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {notice || errorKey ? (
        <div className="flex flex-col gap-2 border-t p-3">
          <RunNotice notice={notice} dismiss={dismiss} />
          <FormError namespace="daily.errors" errorKey={errorKey} />
        </div>
      ) : null}
    </TableCard>
  );
}
