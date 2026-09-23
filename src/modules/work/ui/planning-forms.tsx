"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addWorkTemplateItemAction, applyTemplateAction, changeRecurrenceAction, createProjectFromTemplateAction, createRecurrenceAction, nudgeTaskAction, removeWorkTemplateItemAction, saveWorkTemplateAction } from "../planning-actions";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };
type Person = { id: string; fullName: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (action: (input: unknown) => Promise<Result>, input: unknown, after?: (data: unknown) => void) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.(result.data);
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────

export type TemplateItemView = { id: string; parentItemId: string | null; title: string; roleKey: string | null; dueOffsetDays: number; estimateMinutes: number | null };
export type TemplateView = { id: string; purpose: string; name: string; description: string | null; ownerId: string | null; ownerName: string | null; isActive: boolean; canManage: boolean; roleKeys: string[]; items: TemplateItemView[] };

export function TemplateCreateForm({ owners, canShare }: { owners: { id: string; name: string }[]; canShare: boolean }) {
  const t = useTranslations("work.templates");
  const { run, pending, errorKey } = useRun();
  return (
    <form
      className="toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        run(saveWorkTemplateAction, { purpose: data.get("purpose"), name: data.get("name"), description: data.get("description"), ownerId: data.get("ownerId"), isActive: true }, () => form.reset());
      }}
    >
      <Input name="name" required maxLength={120} placeholder={t("name")} aria-label={t("name")} className="w-64" />
      <Select name="purpose" aria-label={t("purpose")} className="w-44" defaultValue="work_project">
        <option value="work_project">{t("purposes.work_project")}</option>
        <option value="work_task">{t("purposes.work_task")}</option>
      </Select>
      <Select name="ownerId" aria-label={t("owner")} className="w-52" defaultValue={canShare ? "" : owners[0]?.id}>
        {canShare ? <option value="">{t("shared")}</option> : null}
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.name}
          </option>
        ))}
      </Select>
      <Input name="description" maxLength={1000} placeholder={t("descriptionField")} aria-label={t("descriptionField")} className="min-w-0 flex-1" />
      <Button type="submit" size="sm" disabled={pending}>
        {t("create")}
      </Button>
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </form>
  );
}

export function TemplateCard({ template }: { template: TemplateView }) {
  const t = useTranslations("work.templates");
  const { run, pending, errorKey } = useRun();
  const roots = template.items.filter((item) => !item.parentItemId || !template.items.some((other) => other.id === item.parentItemId));
  const row = (item: TemplateItemView, depth: number) => (
    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm" style={{ paddingLeft: depth * 20 }}>
      <span className="min-w-0 flex-1 basis-56">{item.title}</span>
      {item.roleKey ? <Badge variant="outline">{item.roleKey}</Badge> : null}
      <span className="w-16 text-right font-mono text-xs text-muted-foreground">{t("offset", { days: item.dueOffsetDays })}</span>
      {item.estimateMinutes ? <span className="text-xs text-muted-foreground">{t("hours", { hours: Math.round((item.estimateMinutes / 60) * 100) / 100 })}</span> : null}
      {template.canManage ? (
        <button type="button" className="text-xs text-muted-foreground hover:text-destructive" aria-label={t("removeItem", { title: item.title })} disabled={pending} onClick={() => run(removeWorkTemplateItemAction, { itemId: item.id })}>
          ×
        </button>
      ) : null}
    </li>
  );
  return (
    <article className="flex flex-col gap-3 rounded-xl border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{template.name}</h3>
        <Badge variant="secondary">{t(`purposes.${template.purpose}`)}</Badge>
        <Badge variant="outline">{template.ownerName ?? t("shared")}</Badge>
        {template.isActive ? null : <Badge variant="destructive">{t("inactive")}</Badge>}
        {template.canManage ? (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(saveWorkTemplateAction, { templateId: template.id, purpose: template.purpose, name: template.name, description: template.description, ownerId: template.ownerId, isActive: !template.isActive })}>
            {template.isActive ? t("retire") : t("restore")}
          </Button>
        ) : null}
      </header>
      {template.description ? <p className="text-sm text-muted-foreground">{template.description}</p> : null}
      {template.items.length ? <ul className="divide-y">{roots.flatMap((item) => [row(item, 0), ...template.items.filter((child) => child.parentItemId === item.id).map((child) => row(child, 1))])}</ul> : <p className="text-sm text-muted-foreground">{t("noItems")}</p>}
      {template.canManage ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run(addWorkTemplateItemAction, { templateId: template.id, title: data.get("title"), parentItemId: data.get("parentItemId"), roleKey: data.get("roleKey"), dueOffsetDays: data.get("dueOffsetDays"), estimateHours: data.get("estimateHours"), sortOrder: template.items.length }, () => form.reset());
          }}
        >
          <Input name="title" required maxLength={200} placeholder={t("itemTitle")} aria-label={t("itemTitle")} className="min-w-48 flex-1" />
          <Select name="parentItemId" aria-label={t("parent")} className="w-44" defaultValue="">
            <option value="">{t("topLevel")}</option>
            {roots.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
          <Input name="roleKey" maxLength={31} pattern="[a-zA-Z][a-zA-Z0-9_]+" placeholder={t("role")} aria-label={t("role")} list={`roles-${template.id}`} className="w-32" />
          <datalist id={`roles-${template.id}`}>
            {template.roleKeys.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          <Input name="dueOffsetDays" type="number" required defaultValue={0} min={-365} max={365} aria-label={t("offsetField")} title={t("offsetField")} className="w-20" />
          <Input name="estimateHours" type="number" step="0.25" min={0.25} placeholder={t("estimate")} aria-label={t("estimate")} className="w-24" />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t("addItem")}
          </Button>
        </form>
      ) : null}
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </article>
  );
}

/** Use a template: a new project (`teams` given) or more tasks inside an existing one (`projectId`). */
export function TemplateUseForm({
  templates,
  teams,
  projectId,
  peopleByTeam,
  today,
}: {
  templates: { id: string; name: string; ownerId: string | null; roleKeys: string[] }[];
  teams?: { id: string; name: string; defaultVisibility: string }[];
  projectId?: string;
  /** Who can play a role: the team's (and the project's) people. Key "" = the project's own list. */
  peopleByTeam: Record<string, Person[]>;
  today: string;
}) {
  const t = useTranslations("work.templates");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { run, pending, errorKey } = useRun();
  const [teamId, setTeamId] = useState(teams?.[0]?.id ?? "");
  const usable = templates.filter((template) => !template.ownerId || !teams || template.ownerId === teamId);
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? "");
  const template = usable.find((row) => row.id === templateId) ?? usable[0];
  const people = peopleByTeam[teams ? teamId : ""] ?? [];
  const [made, setMade] = useState<number | null>(null);
  if (templates.length === 0 || (teams && teams.length === 0)) return <p className="text-sm text-muted-foreground">{t("nothingToUse")}</p>;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const roles = Object.fromEntries((template?.roleKeys ?? []).map((key) => [key, String(data.get(`role.${key}`) ?? "")]));
        const use = { templateId: template?.id, anchorMode: data.get("anchorMode"), anchorDate: data.get("anchorDate"), roles };
        if (projectId) run(applyTemplateAction, { ...use, projectId }, (result) => setMade((result as { tasks: number }).tasks));
        else run(createProjectFromTemplateAction, { ...use, teamId, name: data.get("name"), visibility: data.get("visibility"), description: "", clientId: "", leadPersonId: "" }, (result) => router.push(`/work/projects/${(result as { id: string }).id}`));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {teams ? (
          <Select aria-label={t("team")} className="w-52" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label={t("template")} className="w-64" value={template?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>
          {usable.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        {teams ? (
          <>
            <Input name="name" required maxLength={120} placeholder={t("projectName")} aria-label={t("projectName")} className="min-w-48 flex-1" />
            <Select name="visibility" aria-label={tWork("projects.fields.visibility")} className="w-40" key={teamId} defaultValue={teams.find((team) => team.id === teamId)?.defaultVisibility ?? "team"}>
              {(["entity", "team", "private"] as const).map((value) => (
                <option key={value} value={value}>
                  {tWork(`visibility.${value}`)}
                </option>
              ))}
            </Select>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select name="anchorMode" aria-label={t("anchorMode")} className="w-56" defaultValue="start">
          <option value="start">{t("anchor.start")}</option>
          <option value="end">{t("anchor.end")}</option>
        </Select>
        <Input name="anchorDate" type="date" required defaultValue={today} aria-label={t("anchorDate")} className="w-44" />
      </div>
      {template?.roleKeys.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{t("whoPlays")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {template.roleKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 font-mono text-xs">{key}</span>
                <Select name={`role.${key}`} aria-label={key} defaultValue="" className="min-w-0 flex-1">
                  <option value="">{t("unassigned")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !template}>
          {projectId ? t("addTasks") : t("createProject")}
        </Button>
        {made !== null ? <span className="text-sm text-muted-foreground">{t("made", { count: made })}</span> : null}
      </div>
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </form>
  );
}

// ── Recurring tasks ─────────────────────────────────────────────────────────────────────────

export type RecurrenceItem = { id: string; title: string; rule: { freq: "daily" | "weekly" | "monthly"; interval: number; weekdays?: number[]; monthDay?: number | "last" }; startDate: string; endDate: string | null; isActive: boolean; assigneeName: string | null; nextDate: string | null; made: number };

export function RecurrenceManager({ projectId, recurrences, people, canManage, today }: { projectId: string; recurrences: RecurrenceItem[]; people: Person[]; canManage: boolean; today: string }) {
  const t = useTranslations("work.recurrence");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly">("weekly");
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const describe = (rule: RecurrenceItem["rule"]) =>
    rule.freq === "daily"
      ? t("rule.daily", { interval: rule.interval })
      : rule.freq === "weekly"
        ? t("rule.weekly", { interval: rule.interval, days: (rule.weekdays ?? []).map((weekday) => t(`weekdays.${weekday}`)).join(", ") })
        : rule.monthDay === "last"
          ? t("rule.monthlyLast", { interval: rule.interval })
          : t("rule.monthly", { interval: rule.interval, day: rule.monthDay ?? 1 });

  return (
    <div className="flex flex-col gap-3">
      {recurrences.length ? (
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {recurrences.map((item) => {
            const ended = !!item.endDate && item.endDate <= today;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{[describe(item.rule), item.assigneeName, t("madeSoFar", { count: item.made }), item.nextDate ? t("next", { date: day(item.nextDate) }) : null].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge variant={ended ? "outline" : item.isActive ? "default" : "secondary"}>{t(ended ? "ended" : item.isActive ? "active" : "paused")}</Badge>
                {canManage && !ended ? (
                  <>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(changeRecurrenceAction, { recurrenceId: item.id, change: item.isActive ? "pause" : "resume" })}>
                      {t(item.isActive ? "pause" : "resume")}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(changeRecurrenceAction, { recurrenceId: item.id, change: "end" })}>
                      {t("end")}
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {canManage ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const interval = data.get("interval");
            const rule = freq === "daily" ? { freq, interval } : freq === "weekly" ? { freq, interval, weekdays: data.getAll("weekdays") } : { freq, interval, monthDay: data.get("monthDay") };
            run(createRecurrenceAction, { projectId, title: data.get("title"), rule, startDate: data.get("startDate"), endDate: data.get("endDate"), leadDays: data.get("leadDays"), assigneePersonId: data.get("assigneePersonId"), priority: "", description: "" }, () => form.reset());
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input name="title" required maxLength={200} placeholder={t("title")} aria-label={t("title")} className="min-w-48 flex-1" />
            <Select name="assigneePersonId" aria-label={t("assignee")} className="w-48" defaultValue="">
              <option value="">{t("unassigned")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("every")}</span>
            <Input name="interval" type="number" required min={1} max={366} defaultValue={1} aria-label={t("interval")} className="w-16" />
            <Select aria-label={t("frequency")} className="w-28" value={freq} onChange={(event) => setFreq(event.target.value as typeof freq)}>
              <option value="daily">{t("freq.daily")}</option>
              <option value="weekly">{t("freq.weekly")}</option>
              <option value="monthly">{t("freq.monthly")}</option>
            </Select>
            {freq === "weekly" ? (
              <span className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                  <label key={weekday} className="flex items-center gap-1">
                    <input type="checkbox" name="weekdays" value={weekday} defaultChecked={weekday === 1} />
                    {t(`weekdays.${weekday}`)}
                  </label>
                ))}
              </span>
            ) : null}
            {freq === "monthly" ? (
              <Select name="monthDay" aria-label={t("monthDay")} className="w-32" defaultValue="1">
                {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {t("onDay", { day: value })}
                  </option>
                ))}
                <option value="last">{t("lastDay")}</option>
              </Select>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              {t("from")}
              <Input name="startDate" type="date" required defaultValue={today} className="w-40" />
            </label>
            <label className="flex items-center gap-2">
              {t("until")}
              <Input name="endDate" type="date" className="w-40" />
            </label>
            <label className="flex items-center gap-2">
              {t("lead")}
              <Input name="leadDays" type="number" min={0} max={60} defaultValue={7} className="w-16" />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {t("create")}
            </Button>
          </div>
        </form>
      ) : null}
      <FormError namespace="work.recurrence.errors" errorKey={errorKey} />
    </div>
  );
}

// ── Leader view ─────────────────────────────────────────────────────────────────────────────

export function NudgeButton({ taskId }: { taskId: string }) {
  const t = useTranslations("work.leader");
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | string>("idle");
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || state === "sent"}
        onClick={() =>
          startTransition(async () => {
            const result: Result = await nudgeTaskAction({ taskId });
            setState(result.ok ? "sent" : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
          })
        }
      >
        {state === "sent" ? t("nudged") : t("nudge")}
      </Button>
      {state !== "idle" && state !== "sent" ? (
        <span role="alert" className="text-xs text-destructive">
          {t.has(`errors.${state}`) ? t(`errors.${state}`) : t("errors.generic")}
        </span>
      ) : null}
    </span>
  );
}
