"use client";
// The approver's side of the weekly timesheet (FR-PJM-25): approve, return with a comment, reopen
// an approved week with a reason, and approve several at once from the waiting list.
import { Check, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { bulkApproveWeeksAction, decideWeekAction, reopenWeekAction } from "../time-actions";
import { TEXTAREA } from "./format";
import { RunNotice } from "./run-notice";
import { useRun } from "./use-run";

export function DecideWeek({ weekId, status }: { weekId: string; status: string }) {
  const t = useTranslations("daily.timesheets");
  const { run, pending, errorKey } = useRun();
  const [mode, setMode] = useState<"return" | "reopen" | null>(null);
  const [text, setText] = useState("");
  if (status !== "submitted" && status !== "approved") return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap gap-2">
        {status === "submitted" ? (
          <>
            <Button type="button" disabled={pending} onClick={() => run(decideWeekAction, { id: weekId, decision: "approve" })}>
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
          <label htmlFor="decision-text" className="text-sm font-medium">
            {mode === "return" ? t("returnComment") : t("reopenReason")}
          </label>
          <textarea id="decision-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required className={TEXTAREA} placeholder={mode === "return" ? t("returnPlaceholder") : t("reopenPlaceholder")} />
          <Button type="submit" size="sm" variant={mode === "return" ? "destructive" : "default"} disabled={pending || !text.trim()} className="self-start">
            {mode === "return" ? t("confirmReturn") : t("confirmReopen")}
          </Button>
        </form>
      ) : null}
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}

export type WaitingRow = { id: string; href: string; name: string; week: string; hours: string; submitted: string | null };

/** Weeks waiting for the approver: open one to read it, or tick several and approve them together. */
export function WaitingList({ rows }: { rows: WaitingRow[] }) {
  const t = useTranslations("daily.timesheets");
  const { run, pending, errorKey, notice, dismiss } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const all = picked.length === rows.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={all} onChange={() => setPicked(all ? [] : rows.map((row) => row.id))} /> {t("selectAll")}
        </label>
        <Button type="button" size="sm" disabled={pending || picked.length === 0} onClick={() => run(bulkApproveWeeksAction, { ids: picked }, () => setPicked([]))}>
          <Check aria-hidden /> {t("approveSelected", { count: picked.length })}
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 p-3 text-sm">
            <input type="checkbox" aria-label={t("pick", { name: row.name, week: row.week })} checked={picked.includes(row.id)} onChange={(event) => setPicked((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))} />
            <Link href={row.href} className="min-w-0 flex-1 hover:underline">
              <span className="font-medium">{row.name}</span>
              <span className="block text-xs text-muted-foreground">{[row.week, row.submitted].filter(Boolean).join(" · ")}</span>
            </Link>
            <span className="tabular-nums">{row.hours}</span>
          </li>
        ))}
      </ul>
      <RunNotice notice={notice} dismiss={dismiss} />
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}
