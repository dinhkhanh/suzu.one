"use client";
// The timer (FR-PJM-24): one tap starts it on a task, one tap stops it. The minutes are counted on
// the server from when it started; the clock shown here is only a courtesy.
import { Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { startTimerAction, stopTimerAction } from "../time-actions";
import { useRun } from "./use-run";

const elapsedOf = (startedAt: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Start a timer on this task, or stop it when it is the one running. Starting stops any other. */
export function TimerButton({ taskId, running }: { taskId: string; running: boolean }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  return (
    <>
      <Button type="button" size="xs" variant={running ? "default" : "ghost"} disabled={pending} onClick={() => (running ? run(stopTimerAction, {}) : run(startTimerAction, { taskId }))} aria-label={running ? t("stop") : t("start")}>
        {running ? <Square aria-hidden /> : <Play aria-hidden />} {running ? t("stop") : t("start")}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}

/** The running timer: what it is on, how long it has run, and Stop. */
export function RunningTimer({ label, startedAt }: { label: string; startedAt: string }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Set on the client only: the server's render and the first paint must agree.
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-3">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">{t("running")}</span> {label}
        </span>
        <span className="font-mono text-sm tabular-nums">{now ? elapsedOf(startedAt, now) : ""}</span>
        <Button type="button" size="sm" disabled={pending} onClick={() => run(stopTimerAction, {})}>
          <Square aria-hidden /> {t("stop")}
        </Button>
      </div>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}
