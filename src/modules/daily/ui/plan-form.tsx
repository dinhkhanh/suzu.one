"use client";
// The morning plan (FR-PJM-21): tick today's tasks from My work, put them in order, see the
// estimates against the hours of the day, save.
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { savePlanAction } from "../actions";
import { hoursOf, TEXTAREA } from "./format";

type Candidate = { taskId: string; key: string; title: string; dueDate: string | null; estimateMinutes: number | null; projectName: string | null; stateName: string; status: string };

export function PlanForm({ date, today, candidates, selected, dayMinutes, note }: { date: string; today: string; candidates: Candidate[]; selected: { taskId: string; minutes: number | null }[]; dayMinutes: number; note: string | null }) {
  const t = useTranslations("daily");
  const router = useRouter();
  const [items, setItems] = useState(selected.filter((item) => candidates.some((task) => task.taskId === item.taskId)));
  const [text, setText] = useState(note ?? "");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(candidates.map((task) => [task.taskId, task])), [candidates]);
  const total = items.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
  const over = total > dayMinutes;

  const toggle = (task: Candidate) => setItems((current) => (current.some((item) => item.taskId === task.taskId) ? current.filter((item) => item.taskId !== task.taskId) : [...current, { taskId: task.taskId, minutes: task.estimateMinutes }]));
  const move = (index: number, by: number) =>
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  const setMinutes = (taskId: string, value: string) => setItems((current) => current.map((item) => (item.taskId === taskId ? { ...item, minutes: value === "" ? null : Math.max(0, Math.min(1440, Number(value) || 0)) } : item)));

  const save = () =>
    startTransition(async () => {
      const result = await savePlanAction({ date, items, note: text });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setSaved(result.ok);
      if (result.ok) router.refresh();
    });

  const rest = candidates.filter((task) => !items.some((item) => item.taskId === task.taskId));
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("plan.chosen", { count: items.length })}</h2>
          <span className={over ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{t("plan.load", { planned: hoursOf(total), available: hoursOf(dayMinutes) })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={over ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${Math.min(100, dayMinutes ? (total / dayMinutes) * 100 : 0)}%` }} />
        </div>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("plan.nothingChosen")}</p> : null}
        <ol className="flex flex-col divide-y rounded-xl border">
          {items.map((item, index) => {
            const task = byId.get(item.taskId)!;
            return (
              <li key={item.taskId} className="flex items-center gap-2 p-2.5 text-sm">
                <div className="flex flex-col">
                  <Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("plan.up")}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={t("plan.down")}>
                    <ArrowDown aria-hidden />
                  </Button>
                </div>
                <label className="flex min-w-0 flex-1 items-start gap-2">
                  <input type="checkbox" className="mt-1" checked onChange={() => toggle(task)} />
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                    {task.status === "done" ? (
                      <Badge variant="success" className="ml-1">
                        {t("plan.doneAlready")}
                      </Badge>
                    ) : null}
                  </span>
                </label>
                <Input type="number" min={0} max={1440} step={15} value={item.minutes ?? ""} onChange={(event) => setMinutes(item.taskId, event.target.value)} aria-label={t("plan.minutes")} placeholder={t("plan.minutesShort")} className="h-8 w-20" />
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("plan.myWork", { count: rest.length })}</h2>
        {rest.length === 0 ? <p className="text-sm text-muted-foreground">{t("plan.noMoreWork")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {rest.map((task) => (
            <li key={task.taskId}>
              <label className="flex items-start gap-2 p-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={false} onChange={() => toggle(task)} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                  <span className="block text-xs text-muted-foreground">{[task.projectName, task.stateName, task.estimateMinutes ? t("hours", { value: hoursOf(task.estimateMinutes) }) : null].filter(Boolean).join(" · ")}</span>
                </span>
                {task.dueDate && task.dueDate < today ? <Badge variant="destructive">{t("overdue")}</Badge> : task.dueDate === today ? <Badge variant="warning">{t("dueToday")}</Badge> : null}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor="plan-note" className="text-sm font-medium text-muted-foreground">
          {t("plan.note")}
        </label>
        <textarea id="plan-note" value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} className={TEXTAREA} placeholder={t("plan.notePlaceholder")} />
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button type="button" size="lg" disabled={pending} onClick={save} className="flex-1 sm:flex-none">
          {t("plan.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
        <FormError namespace="daily.errors" errorKey={errorKey} />
      </div>
    </div>
  );
}
