"use client";
// The triage queue (FR-PJM-32): one card per incoming task with the lead's four answers — accept,
// decline, merge, snooze — and the team's triage rules below.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TRIAGE_SOURCES } from "../engine/triage";
import { PRIORITIES } from "../enums";
import { acceptTriageAction, declineTriageAction, deleteTriageRuleAction, mergeTriageAction, saveTriageRuleAction, snoozeTriageAction } from "../foundation-actions";
import { LabelChip } from "./team-forms";

type Named = { id: string; name: string };
type Person = { id: string; fullName: string };
export type TriageCard = { id: string; key: string; title: string; description: string | null; source: string | null; triageStatus: string | null; snoozedUntil: string | null; requesterName: string | null; formName: string | null; createdAt: string; assigneePersonId: string | null; projectId: string | null; dueDate: string | null; priority: number | null; labelIds: string[] };
export type TriageRuleView = { id: string; name: string; match: { source?: string; intakeFormId?: string; keyword?: string }; set: { assigneePersonId?: string; projectId?: string; labelIds?: string[]; priority?: number }; sortOrder: number; isActive: boolean };
type Choices = { people: Person[]; projects: Named[]; labels: { id: string; name: string; color: string }[]; forms: Named[]; mergeTargets: { id: string; key: string; title: string }[] };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("work");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

const localDate = (value: string) => value.split("-").reverse().join("/");

export function TriageQueue({ items, choices, canDecide, today }: { items: TriageCard[]; choices: Choices; canDecide: boolean; today: string }) {
  const t = useTranslations("work.triage");
  const pending = items.filter((item) => item.triageStatus === "pending");
  const snoozed = items.filter((item) => item.triageStatus === "snoozed");
  return (
    <div className="flex flex-col gap-6">
      {canDecide ? null : <p className="text-sm text-muted-foreground">{t("readOnly")}</p>}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("pending", { count: pending.length })}</h2>
        {pending.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}
        {pending.map((item) => (
          <TriageItemCard key={item.id} item={item} choices={choices} canDecide={canDecide} today={today} />
        ))}
      </section>
      {snoozed.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("snoozed", { count: snoozed.length })}</h2>
          {snoozed.map((item) => (
            <TriageItemCard key={item.id} item={item} choices={choices} canDecide={canDecide} today={today} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function TriageItemCard({ item, choices, canDecide, today }: { item: TriageCard; choices: Choices; canDecide: boolean; today: string }) {
  const t = useTranslations("work.triage");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const [mode, setMode] = useState<"accept" | "decline" | "merge" | "snooze" | null>(null);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  return (
    <article className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
        <Link href={`/work/tasks/${item.id}`} className="min-w-0 flex-1 font-medium hover:underline">
          {item.title}
        </Link>
        {item.source ? <Badge variant="outline">{t.has(`sources.${item.source}`) ? t(`sources.${item.source}`) : item.source}</Badge> : null}
        {item.snoozedUntil ? <Badge variant="warning">{t("until", { date: localDate(item.snoozedUntil) })}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">{[t("from", { name: item.requesterName ?? "—", date: format.dateTime(new Date(item.createdAt), { dateStyle: "medium" }) }), item.formName ? t("viaForm", { form: item.formName }) : null].filter(Boolean).join(" · ")}</p>
      {item.description ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{tWork("task.fields.description")}</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.description}</p>
        </details>
      ) : null}
      {item.assigneePersonId || item.projectId || item.priority || item.labelIds.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {t("prefilled")}:{" "}
          {[choices.people.find((person) => person.id === item.assigneePersonId)?.fullName, choices.projects.find((project) => project.id === item.projectId)?.name, item.priority ? tWork(`priority.${item.priority}`) : null].filter(Boolean).join(" · ")}
          {item.labelIds.map((id) => {
            const label = choices.labels.find((row) => row.id === id);
            return label ? <LabelChip key={id} name={label.name} color={label.color} /> : null;
          })}
        </p>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          {(["accept", "decline", "merge", "snooze"] as const).map((action) => (
            <Button key={action} size="sm" variant={mode === action ? "default" : action === "accept" ? "outline" : "ghost"} onClick={() => setMode(mode === action ? null : action)}>
              {t(action)}
            </Button>
          ))}
        </div>
      ) : null}
      {mode === "accept" ? (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() => acceptTriageAction({ taskId: item.id, assigneePersonId: data.get("assigneePersonId"), projectId: data.get("projectId"), dueDate: data.get("dueDate"), priority: data.get("priority") }));
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`assignee-${item.id}`}>{tWork("task.fields.assignee")}</Label>
            <Select id={`assignee-${item.id}`} name="assigneePersonId" defaultValue={item.assigneePersonId ?? ""}>
              <option value="">{tWork("list.unassigned")}</option>
              {choices.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`project-${item.id}`}>{tWork("task.fields.project")}</Label>
            <Select id={`project-${item.id}`} name="projectId" defaultValue={item.projectId ?? ""}>
              <option value="">{tWork("task.noProject")}</option>
              {choices.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`due-${item.id}`}>{tWork("task.fields.dueDate")}</Label>
            <Input id={`due-${item.id}`} name="dueDate" type="date" defaultValue={item.dueDate ?? ""} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`priority-${item.id}`}>{tWork("task.fields.priority")}</Label>
            <Select id={`priority-${item.id}`} name="priority" defaultValue={item.priority ? String(item.priority) : ""}>
              <option value="">{tWork("priority.none")}</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {tWork(`priority.${priority}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={pending}>
            {t("accept")}
          </Button>
        </form>
      ) : mode === "decline" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => declineTriageAction({ taskId: item.id, reason: new FormData(event.currentTarget).get("reason") }));
          }}
        >
          <Label htmlFor={`reason-${item.id}`}>{t("declineReason")}</Label>
          <textarea id={`reason-${item.id}`} name="reason" required maxLength={1000} rows={3} className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" />
          <Button type="submit" size="sm" variant="destructive" className="self-start" disabled={pending}>
            {t("decline")}
          </Button>
        </form>
      ) : mode === "merge" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => mergeTriageAction({ taskId: item.id, intoTaskId: new FormData(event.currentTarget).get("intoTaskId") }));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor={`merge-${item.id}`}>{t("mergeInto")}</Label>
            <Select id={`merge-${item.id}`} name="intoTaskId" required defaultValue="">
              <option value="" disabled>
                {t("chooseTask")}
              </option>
              {choices.mergeTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.key} {target.title}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {t("merge")}
          </Button>
        </form>
      ) : mode === "snooze" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => snoozeTriageAction({ taskId: item.id, until: new FormData(event.currentTarget).get("until") }));
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`until-${item.id}`}>{t("snoozeUntil")}</Label>
            <Input id={`until-${item.id}`} name="until" type="date" required min={tomorrow} defaultValue={item.snoozedUntil ?? tomorrow} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {t("snooze")}
          </Button>
        </form>
      ) : null}
      <ErrorLine errorKey={errorKey} />
    </article>
  );
}

export function TriageRuleManager({ teamId, rules, choices, canManage }: { teamId: string; rules: TriageRuleView[]; choices: Omit<Choices, "mergeTargets">; canManage: boolean }) {
  const t = useTranslations("work.triage.rules");
  const tTriage = useTranslations("work.triage");
  const tWork = useTranslations("work");
  const { run, pending, errorKey } = useRun();
  const [editing, setEditing] = useState<string | null>(null);
  const describe = (rule: TriageRuleView) => {
    const when = [rule.match.source ? tTriage(`sources.${rule.match.source as "intake"}`) : null, rule.match.intakeFormId ? choices.forms.find((form) => form.id === rule.match.intakeFormId)?.name : null, rule.match.keyword ? `“${rule.match.keyword}”` : null].filter(Boolean).join(" · ");
    const then = [choices.people.find((person) => person.id === rule.set.assigneePersonId)?.fullName, choices.projects.find((project) => project.id === rule.set.projectId)?.name, rule.set.priority ? tWork(`priority.${rule.set.priority}`) : null, ...(rule.set.labelIds ?? []).map((id) => choices.labels.find((label) => label.id === id)?.name)].filter(Boolean).join(" · ");
    return `${t("summaryWhen", { conditions: when || t("summaryAll") })} → ${t("summaryThen", { values: then })}`;
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      {rules.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-medium ${rule.isActive ? "" : "text-muted-foreground line-through"}`}>{rule.name}</span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">{describe(rule)}</span>
              {canManage ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === rule.id ? null : rule.id)}>
                    {tWork("customFields.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => window.confirm(t("deleteConfirm")) && run(() => deleteTriageRuleAction({ ruleId: rule.id }))}>
                    {t("delete")}
                  </Button>
                </>
              ) : null}
            </div>
            {editing === rule.id ? <RuleForm teamId={teamId} rule={rule} choices={choices} onDone={() => setEditing(null)} /> : null}
          </li>
        ))}
      </ul>
      <ErrorLine errorKey={errorKey} />
      {canManage ? editing === "new" ? <RuleForm teamId={teamId} choices={choices} onDone={() => setEditing(null)} /> : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing("new")}>
          {t("add")}
        </Button>
      ) : null}
    </div>
  );
}

function RuleForm({ teamId, rule, choices, onDone }: { teamId: string; rule?: TriageRuleView; choices: Omit<Choices, "mergeTargets">; onDone: () => void }) {
  const t = useTranslations("work.triage.rules");
  const tTriage = useTranslations("work.triage");
  const tWork = useTranslations("work");
  const { run, pending, errorKey } = useRun();
  const id = rule?.id ?? "new";
  return (
    <form
      className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () =>
            saveTriageRuleAction({
              ruleId: rule?.id ?? null,
              teamId,
              name: data.get("name"),
              source: data.get("source"),
              intakeFormId: data.get("intakeFormId"),
              keyword: data.get("keyword"),
              assigneePersonId: data.get("assigneePersonId"),
              projectId: data.get("projectId"),
              labelIds: data.getAll("labelIds").map(String),
              priority: data.get("priority"),
              sortOrder: data.get("sortOrder"),
              isActive: data.get("isActive") === "on",
            }),
          onDone,
        );
      }}
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`rule-name-${id}`}>{t("name")}</Label>
        <Input id={`rule-name-${id}`} name="name" required maxLength={80} defaultValue={rule?.name} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-muted-foreground">{t("when")}</legend>
        <Label htmlFor={`rule-source-${id}`}>{t("source")}</Label>
        <Select id={`rule-source-${id}`} name="source" defaultValue={rule?.match.source ?? ""}>
          <option value="">{t("anySource")}</option>
          {TRIAGE_SOURCES.map((source) => (
            <option key={source} value={source}>
              {tTriage(`sources.${source}`)}
            </option>
          ))}
        </Select>
        <Label htmlFor={`rule-form-${id}`}>{t("form")}</Label>
        <Select id={`rule-form-${id}`} name="intakeFormId" defaultValue={rule?.match.intakeFormId ?? ""}>
          <option value="">{t("anyForm")}</option>
          {choices.forms.map((form) => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </Select>
        <Label htmlFor={`rule-keyword-${id}`}>{t("keyword")}</Label>
        <Input id={`rule-keyword-${id}`} name="keyword" maxLength={200} defaultValue={rule?.match.keyword ?? ""} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-muted-foreground">{t("then")}</legend>
        <Label htmlFor={`rule-assignee-${id}`}>{t("assignee")}</Label>
        <Select id={`rule-assignee-${id}`} name="assigneePersonId" defaultValue={rule?.set.assigneePersonId ?? ""}>
          <option value="">{t("none")}</option>
          {choices.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
        <Label htmlFor={`rule-project-${id}`}>{t("project")}</Label>
        <Select id={`rule-project-${id}`} name="projectId" defaultValue={rule?.set.projectId ?? ""}>
          <option value="">{t("none")}</option>
          {choices.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Label htmlFor={`rule-priority-${id}`}>{t("priority")}</Label>
        <Select id={`rule-priority-${id}`} name="priority" defaultValue={rule?.set.priority ? String(rule.set.priority) : ""}>
          <option value="">{t("none")}</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {tWork(`priority.${priority}`)}
            </option>
          ))}
        </Select>
        {choices.labels.length ? (
          <>
            <span className="text-sm font-medium">{t("labels")}</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {choices.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="labelIds" value={label.id} defaultChecked={rule?.set.labelIds?.includes(label.id)} />
                  <LabelChip name={label.name} color={label.color} />
                </label>
              ))}
            </div>
          </>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rule-order-${id}`}>{t("sortOrder")}</Label>
          <Input id={`rule-order-${id}`} name="sortOrder" type="number" min={0} max={10000} defaultValue={rule?.sortOrder ?? 0} className="w-24" />
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={rule?.isActive ?? true} /> {t("isActive")}
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tWork("customFields.cancel")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorLine errorKey={errorKey} />
      </div>
    </form>
  );
}
