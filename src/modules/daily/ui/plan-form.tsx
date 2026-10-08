"use client";
// The morning plan (FR-PJM-21): tick today's tasks from My work, put them in order, see the
// estimates against the hours of the day, save.
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type CSSProperties, useMemo, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { savePlanAction } from "../actions";
import { hoursOf } from "./format";

type Candidate = { taskId: string; key: string; title: string; dueDate: string | null; estimateMinutes: number | null; projectName: string | null; stateName: string; status: string };

/** Minutes as the hours field shows them: one decimal, nothing for none. */
const hoursText = (minutes: number | null) => (minutes === null ? "" : hoursOf(minutes));

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

  const toggle = (task: Candidate) =>
    setItems((current) => (current.some((item) => item.taskId === task.taskId) ? current.filter((item) => item.taskId !== task.taskId) : [...current, { taskId: task.taskId, minutes: task.estimateMinutes }]));
  const move = (index: number, by: number) =>
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  // The field takes hours ("1.5"); the plan keeps minutes.
  const setHours = (taskId: string, value: string) =>
    setItems((current) => current.map((item) => (item.taskId === taskId ? { ...item, minutes: value === "" ? null : Math.max(0, Math.min(1440, Math.round((Number(value.replace(",", ".")) || 0) * 60))) } : item)));

  const save = () =>
    startTransition(async () => {
      const result = await savePlanAction({ date, items, note: text });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setSaved(result.ok);
      if (result.ok) router.refresh();
    });

  const rest = candidates.filter((task) => !items.some((item) => item.taskId === task.taskId));
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Section title={t("plan.chosen", { count: items.length })}>
        <div className="flex flex-col gap-1.5 px-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className={over ? "font-mono text-sm font-medium text-destructive tabular-nums" : "font-mono text-sm text-muted-foreground tabular-nums"}>{t("plan.load", { planned: hoursOf(total), available: hoursOf(dayMinutes) })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={over ? "h-full rounded-full bg-destructive transition-[width] duration-200 ease-(--ease-settle)" : "h-full rounded-full bg-primary transition-[width] duration-200 ease-(--ease-settle)"}
              style={{ width: `${Math.min(100, dayMinutes ? (total / dayMinutes) * 100 : 0)}%` }}
            />
          </div>
        </div>
        <List numbered>
          {items.length === 0 ? <ListEmpty>{t("plan.nothingChosen")}</ListEmpty> : null}
          {items.map((item, index) => {
            const task = byId.get(item.taskId)!;
            return (
              <ListItem key={item.taskId} className="gap-2 pl-0 md:pl-0">
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <Checkbox checked onCheckedChange={() => toggle(task)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      <span className="font-mono text-xs font-normal text-muted-foreground">{task.key}</span> {task.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[task.projectName, task.stateName].filter(Boolean).join(" · ")}
                      {task.status === "done" ? (
                        <Badge variant="success" className="ml-1.5 align-middle">
                          {t("plan.doneAlready")}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </label>
                <span className="flex shrink-0 items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    inputMode="decimal"
                    value={hoursText(item.minutes)}
                    onChange={(event) => setHours(item.taskId, event.target.value)}
                    aria-label={t("plan.hoursLabel")}
                    placeholder="0"
                    className="h-9 w-16 px-2 text-right font-mono text-[0.8125rem] tabular-nums md:h-8"
                  />
                  <span className="text-xs text-muted-foreground">{t("plan.hoursShort")}</span>
                </span>
                <span className="flex shrink-0 flex-col">
                  <Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("plan.up")}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={t("plan.down")}>
                    <ArrowDown aria-hidden />
                  </Button>
                </span>
              </ListItem>
            );
          })}
        </List>
      </Section>

      <Section title={t("plan.myWork", { count: rest.length })}>
        <List>
          {rest.length === 0 ? <ListEmpty>{t("plan.noMoreWork")}</ListEmpty> : null}
          {rest.map((task, index) => (
            <ListItem key={task.taskId} className="rise p-0 md:p-0" style={{ "--i": index } as CSSProperties}>
              <label className="flex min-h-[3.25rem] flex-1 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-canvas md:min-h-12 md:px-3.5">
                <Checkbox checked={false} onCheckedChange={() => toggle(task)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <span className="font-mono text-xs font-normal text-muted-foreground">{task.key}</span> {task.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{[task.projectName, task.stateName, task.estimateMinutes ? t("hours", { value: hoursOf(task.estimateMinutes) }) : null].filter(Boolean).join(" · ")}</span>
                </span>
                {task.dueDate && task.dueDate < today ? <Badge variant="destructive">{t("overdue")}</Badge> : task.dueDate === today ? <Badge variant="warning">{t("dueToday")}</Badge> : null}
              </label>
            </ListItem>
          ))}
        </List>
      </Section>

      <Section title={<label htmlFor="plan-note">{t("plan.note")}</label>}>
        <NoteEditor id="plan-note" draft={`daily-plan:${date}`} value={text} onChange={setText} maxLength={1000} placeholder={t("plan.notePlaceholder")} />
      </Section>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <Button type="button" size="lg" variant="accent" disabled={pending} onClick={save} className="w-full md:w-auto">
          {t("plan.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
        <FormError namespace="daily.errors" errorKey={errorKey} />
      </div>
    </div>
  );
}
