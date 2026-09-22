"use client";
// Automations (FR-PJM-33) on screen: the team's rules — or a project's own — each read as one
// sentence ("When a task enters Client review, set its due date 2 working days out"), the starter
// rules a lead adds in one tap, the rule builder with the same sentence as a live preview, and the
// latest runs. Only whoever runs the team changes anything; the team's people read.
import { Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addAutomationPresetAction, removeAutomationAction, saveAutomationAction, toggleAutomationAction } from "../automation-actions";
import { AUTOMATION_ACTIONS, AUTOMATION_PRESETS, AUTOMATION_TRIGGERS, type AutomationPreset, CLIENT_DECISIONS, CONDITION_FIELDS, CONDITION_OPS, MAX_RULE_ACTIONS, MAX_RULE_CONDITIONS, QUOTA_PERCENTS, ROLES_FOR, WATCHED_FIELDS } from "../engine/automation";
import { CUSTOM_PREFIX } from "../engine/custom-fields";
import { CHANNELS, CONTENT_FORMATS, PRIORITIES } from "../enums";
import type { AutomationAction, AutomationCondition, AutomationTrigger } from "../schema";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

type Named = { id: string; name: string };
export type AutomationView = { id: string; name: string; projectId: string | null; projectName: string | null; trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[]; isActive: boolean; runCount: number; lastRunAt: string | null };
export type AutomationOptions = { states: Named[]; labels: Named[]; people: { id: string; fullName: string }[]; fields: { id: string; name: string; options: { id: string; label: string }[] }[]; templates: Named[] };
export type AutomationRunItem = { id: string; ruleName: string; taskId: string | null; taskKey: string | null; taskTitle: string | null; outcome: string; createdAt: string; failure: string | null };

// ── The sentence ────────────────────────────────────────────────────────────────────────────

/** A rule in words, from the same parts the builder edits. */
function useDescribe(options: AutomationOptions) {
  const t = useTranslations("work.automations");
  const tWork = useTranslations("work");
  const named = (list: Named[], id: string | undefined) => list.find((item) => item.id === id)?.name ?? "—";
  const person = (id: string | undefined) => options.people.find((item) => item.id === id)?.fullName ?? "—";
  const fieldName = (field: string | undefined) => (!field ? "—" : field.startsWith(CUSTOM_PREFIX) ? named(options.fields, field.slice(CUSTOM_PREFIX.length)) : t(`fields.${field}`));
  const who = (action: AutomationAction, fallback?: string) => (action.personId ? person(action.personId) : action.to ? t(`roles.${action.to.replace("role:", "")}`) : fallback ? t(`roles.${fallback}`) : "—");
  const valueText = (condition: AutomationCondition) => {
    const value = condition.value === null || condition.value === undefined ? "" : String(condition.value);
    switch (condition.field) {
      case "priority":
        return value ? tWork(`priority.${value}`) : "—";
      case "assignee":
        return person(value);
      case "label":
        return named(options.labels, value);
      case "channel":
        return value ? tWork(`channels.${value}`) : "—";
      case "contentFormat":
        return value ? tWork(`formats.${value}`) : "—";
      default: {
        const field = options.fields.find((item) => `${CUSTOM_PREFIX}${item.id}` === condition.field);
        return field?.options.find((option) => option.id === value)?.label ?? value;
      }
    }
  };

  const trigger = (value: AutomationTrigger) => {
    switch (value.type) {
      case "state_entered":
        return t("sentence.trigger.state_entered", { state: named(options.states, value.stateId) });
      case "field_changed":
        return t("sentence.trigger.field_changed", { field: fieldName(value.field) });
      case "due_date_reached":
        return t("sentence.trigger.due_date_reached", { days: value.days ?? 0 });
      case "client_decision":
        return value.decision ? t("sentence.trigger.client_decision_is", { decision: t(`decisions.${value.decision}`) }) : t("sentence.trigger.client_decision");
      case "quota_threshold":
        return t("sentence.trigger.quota_threshold", { percent: value.percent ?? 100 });
      default:
        return t.has(`sentence.trigger.${value.type}`) ? t(`sentence.trigger.${value.type}`) : value.type;
    }
  };
  const condition = (value: AutomationCondition) => t(`sentence.condition.${value.op}`, { field: fieldName(value.field), value: valueText(value) });
  const action = (value: AutomationAction) => {
    switch (value.type) {
      case "move_state":
        return t("sentence.action.move_state", { state: named(options.states, value.stateId) });
      case "assign":
        return t("sentence.action.assign", { person: who(value) });
      case "add_label":
        return t("sentence.action.add_label", { label: named(options.labels, value.labelId) });
      case "add_follower":
        return t("sentence.action.add_follower", { person: who(value) });
      case "set_due":
        return t("sentence.action.set_due", { days: value.days ?? 0 });
      case "create_task":
        return t("sentence.action.create_task", { template: named(options.templates, value.templateId) });
      case "request_review":
        return t("sentence.action.request_review", { person: value.personId || value.to ? who(value) : t("roles.reviewer") });
      case "notify":
        return t("sentence.action.notify", { person: who(value, "assignee"), text: value.text ?? "" });
      case "comment":
        return t("sentence.action.comment", { text: value.text ?? "" });
      default:
        return value.type;
    }
  };
  return (rule: { trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[] }) => {
    const when = trigger(rule.trigger);
    const conditions = rule.conditions.map(condition);
    const actions = rule.actions.map(action);
    return t(conditions.length ? "sentence.withConditions" : "sentence.plain", { when, conditions: conditions.join(t("sentence.and")), actions: actions.length ? actions.join(t("sentence.then")) : "…" });
  };
}

// ── The page's panel ────────────────────────────────────────────────────────────────────────

export function AutomationManager({ teamId, projectId = null, rules, options, runs, canManage }: { teamId: string; projectId?: string | null; rules: AutomationView[]; options: AutomationOptions; runs: AutomationRunItem[]; canManage: boolean }) {
  const t = useTranslations("work.automations");
  const describe = useDescribe(options);
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await action();
      setErrorKey(errorKeyOf(result));
      if (result.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t(projectId ? "projectHint" : "teamHint")}</p>
      {canManage ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("presets.title")}</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {AUTOMATION_PRESETS.map((preset: AutomationPreset) => (
              <li key={preset} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
                <span className="font-medium">{t(`presets.${preset}.name`)}</span>
                <span className="text-xs text-muted-foreground">{t(`presets.${preset}.hint`)}</span>
                <Button type="button" size="sm" variant="outline" disabled={pending} className="mt-auto self-start" onClick={() => run(() => addAutomationPresetAction({ teamId, projectId, preset }))}>
                  <Plus aria-hidden className="size-4" /> {t("presets.add")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <DeliveryError errorKey={errorKey} />

      {rules.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => {
          const inherited = !!projectId && !rule.projectId;
          const editable = canManage && !inherited;
          return (
            <li key={rule.id} className="rounded-xl border p-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rule.name}</span>
                    {rule.projectName ? <Badge variant="secondary">{rule.projectName}</Badge> : null}
                    {inherited ? <Badge variant="outline">{t("fromTeam")}</Badge> : null}
                    {rule.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                    <span className="text-xs text-muted-foreground">{rule.lastRunAt ? t("runs.count", { count: rule.runCount, when: format.dateTime(new Date(rule.lastRunAt), { dateStyle: "short", timeStyle: "short" }) }) : t("runs.never")}</span>
                  </span>
                  <span className="text-muted-foreground">{describe(rule)}</span>
                </summary>
                {editable ? (
                  <div className="flex flex-col gap-3 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => toggleAutomationAction({ automationId: rule.id, isActive: !rule.isActive }))}>
                        {rule.isActive ? t("turnOff") : t("turnOn")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} className="text-destructive" onClick={() => window.confirm(t("confirmRemove", { name: rule.name })) && run(() => removeAutomationAction({ automationId: rule.id }))}>
                        <Trash2 aria-hidden className="size-4" /> {t("remove")}
                      </Button>
                    </div>
                    <RuleForm teamId={teamId} projectId={rule.projectId} options={options} rule={rule} />
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("create")}</summary>
          <div className="pt-3">
            <RuleForm teamId={teamId} projectId={projectId} options={options} />
          </div>
        </details>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("runs.title")}</h2>
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("runs.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {runs.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm">
              <Badge variant={item.outcome === "failed" ? "destructive" : item.outcome === "skipped" ? "outline" : "secondary"}>{t(`outcomes.${item.outcome}`)}</Badge>
              <span className="font-medium">{item.ruleName}</span>
              {item.taskId && item.taskKey ? (
                <Link href={`/work/tasks/${item.taskId}`} className="min-w-0 truncate hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{item.taskKey}</span> {item.taskTitle}
                </Link>
              ) : null}
              <time className="ml-auto text-xs text-muted-foreground">{format.dateTime(new Date(item.createdAt), { dateStyle: "short", timeStyle: "short" })}</time>
              {item.failure ? <p className="w-full text-xs text-destructive">{t("runs.failure", { error: item.failure })}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── The builder ─────────────────────────────────────────────────────────────────────────────

const blankAction = (type: string): AutomationAction => (type === "set_due" ? { type, days: 2 } : type === "notify" ? { type, to: "role:assignee", text: "" } : { type });

function RuleForm({ teamId, projectId, options, rule }: { teamId: string; projectId: string | null; options: AutomationOptions; rule?: AutomationView }) {
  const t = useTranslations("work.automations");
  const describe = useDescribe(options);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(rule?.trigger ?? { type: "state_entered", stateId: options.states[0]?.id });
  const [conditions, setConditions] = useState<AutomationCondition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [blankAction("assign")]);
  const [isActive, setActive] = useState(rule?.isActive ?? true);
  const quota = trigger.type === "quota_threshold";
  const fieldChoices = [...CONDITION_FIELDS.map((field) => ({ value: field, label: t(`fields.${field}`) })), ...options.fields.map((field) => ({ value: `${CUSTOM_PREFIX}${field.id}`, label: field.name }))];
  const watchedChoices = [...WATCHED_FIELDS.map((field) => ({ value: field, label: t(`fields.${field}`) })), ...options.fields.map((field) => ({ value: `${CUSTOM_PREFIX}${field.id}`, label: field.name }))];

  const save = () =>
    startTransition(async () => {
      const result = await saveAutomationAction({ automationId: rule?.id ?? null, teamId, projectId, name, trigger, conditions: quota ? [] : conditions, actions, isActive });
      setErrorKey(errorKeyOf(result));
      if (!result.ok) return;
      router.refresh();
      if (!rule) {
        setName("");
        setConditions([]);
        setActions([blankAction("assign")]);
      }
    });

  const setTriggerType = (type: string) => {
    if (type === "state_entered") setTrigger({ type, stateId: options.states[0]?.id });
    else if (type === "field_changed") setTrigger({ type, field: "assignee" });
    else if (type === "quota_threshold") setTrigger({ type, percent: 80 });
    else if (type === "due_date_reached") setTrigger({ type, days: 0 });
    else setTrigger({ type });
  };
  const updateCondition = (index: number, patch: Partial<AutomationCondition>) => setConditions((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const updateAction = (index: number, patch: Partial<AutomationAction>) => setActions((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`rule-name-${rule?.id ?? "new"}`}>{t("name")}</Label>
        <Input id={`rule-name-${rule?.id ?? "new"}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={t("namePlaceholder")} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("when")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label={t("when")} value={trigger.type} onChange={(event) => setTriggerType(event.target.value)}>
            {AUTOMATION_TRIGGERS.map((type) => (
              <option key={type} value={type}>
                {t(`triggers.${type}`)}
              </option>
            ))}
          </Select>
          {trigger.type === "state_entered" ? (
            <Select aria-label={t("state")} value={trigger.stateId ?? ""} onChange={(event) => setTrigger({ ...trigger, stateId: event.target.value })}>
              {options.states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </Select>
          ) : trigger.type === "field_changed" ? (
            <Select aria-label={t("field")} value={trigger.field ?? ""} onChange={(event) => setTrigger({ ...trigger, field: event.target.value })}>
              {watchedChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          ) : trigger.type === "client_decision" ? (
            <Select aria-label={t("decision")} value={trigger.decision ?? ""} onChange={(event) => setTrigger({ type: trigger.type, ...(event.target.value ? { decision: event.target.value } : {}) })}>
              <option value="">{t("anyDecision")}</option>
              {CLIENT_DECISIONS.map((decision) => (
                <option key={decision} value={decision}>
                  {t(`decisions.${decision}`)}
                </option>
              ))}
            </Select>
          ) : trigger.type === "quota_threshold" ? (
            <Select aria-label={t("percent")} value={String(trigger.percent ?? 80)} onChange={(event) => setTrigger({ ...trigger, percent: Number(event.target.value) })}>
              {QUOTA_PERCENTS.map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </Select>
          ) : trigger.type === "due_date_reached" ? (
            <Input aria-label={t("daysAfterDue")} type="number" min={0} max={30} value={trigger.days ?? 0} onChange={(event) => setTrigger({ ...trigger, days: Math.max(0, Number(event.target.value) || 0) })} />
          ) : null}
        </div>
      </fieldset>

      {quota ? (
        <p className="text-xs text-muted-foreground">{t("quotaHint")}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{t("onlyIf")}</legend>
          {conditions.map((condition, index) => (
            <div key={index} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Select aria-label={t("field")} value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value, value: null })}>
                {fieldChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
              <Button type="button" size="icon" variant="ghost" aria-label={t("removeCondition")} onClick={() => setConditions((list) => list.filter((_, at) => at !== index))} className="sm:order-last">
                <Trash2 aria-hidden className="size-4" />
              </Button>
              <Select aria-label={t("op")} value={condition.op} onChange={(event) => updateCondition(index, { op: event.target.value as AutomationCondition["op"] })}>
                {CONDITION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {t(`ops.${op}`)}
                  </option>
                ))}
              </Select>
              {condition.op === "eq" || condition.op === "neq" ? <ConditionValue condition={condition} options={options} onChange={(value) => updateCondition(index, { value })} /> : <span />}
            </div>
          ))}
          {conditions.length < MAX_RULE_CONDITIONS ? (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setConditions((list) => [...list, { field: "priority", op: "eq", value: null }])}>
              <Plus aria-hidden className="size-4" /> {t("addCondition")}
            </Button>
          ) : null}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("then")}</legend>
        {actions.map((action, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-lg border p-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Select aria-label={t("action")} value={action.type} onChange={(event) => setActions((list) => list.map((item, at) => (at === index ? blankAction(event.target.value) : item)))}>
                {AUTOMATION_ACTIONS.filter((type) => !quota || type === "notify" || type === "create_task").map((type) => (
                  <option key={type} value={type}>
                    {t(`actions.${type}`)}
                  </option>
                ))}
              </Select>
              <Button type="button" size="icon" variant="ghost" aria-label={t("removeAction")} disabled={actions.length === 1} onClick={() => setActions((list) => list.filter((_, at) => at !== index))}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
            <ActionFields action={action} options={options} quota={quota} onChange={(patch) => updateAction(index, patch)} />
          </div>
        ))}
        {actions.length < MAX_RULE_ACTIONS ? (
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setActions((list) => [...list, blankAction(quota ? "notify" : "add_label")])}>
            <Plus aria-hidden className="size-4" /> {t("addAction")}
          </Button>
        ) : null}
      </fieldset>

      <p className="rounded-lg bg-muted/50 p-2.5 text-sm" aria-live="polite">
        {describe({ trigger, conditions: quota ? [] : conditions, actions })}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(event) => setActive(event.target.checked)} /> {t("active")}
      </label>
      <DeliveryError errorKey={errorKey} />
      <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={save} className="self-start">
        {t("save")}
      </Button>
    </div>
  );
}

function ConditionValue({ condition, options, onChange }: { condition: AutomationCondition; options: AutomationOptions; onChange: (value: string | number | null) => void }) {
  const t = useTranslations("work.automations");
  const tWork = useTranslations("work");
  const value = condition.value === null || condition.value === undefined ? "" : String(condition.value);
  const choose = (choices: { value: string; label: string }[]) => (
    <Select aria-label={t("value")} value={value} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">—</option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </Select>
  );
  switch (condition.field) {
    case "priority":
      return choose(PRIORITIES.map((priority) => ({ value: String(priority), label: tWork(`priority.${priority}`) })));
    case "assignee":
      return choose(options.people.map((person) => ({ value: person.id, label: person.fullName })));
    case "label":
      return choose(options.labels.map((label) => ({ value: label.id, label: label.name })));
    case "channel":
      return choose(CHANNELS.map((channel) => ({ value: channel, label: tWork(`channels.${channel}`) })));
    case "contentFormat":
      return choose(CONTENT_FORMATS.map((format) => ({ value: format, label: tWork(`formats.${format}`) })));
    default: {
      const field = options.fields.find((item) => `${CUSTOM_PREFIX}${item.id}` === condition.field);
      if (field?.options.length) return choose(field.options.map((option) => ({ value: option.id, label: option.label })));
      return <Input aria-label={t("value")} value={value} maxLength={200} onChange={(event) => onChange(event.target.value || null)} />;
    }
  }
}

/** Whom an action names: one of the roles it allows, or a person. */
function PersonChoice({ action, roles, options, onChange }: { action: AutomationAction; roles: readonly string[]; options: AutomationOptions; onChange: (patch: Partial<AutomationAction>) => void }) {
  const t = useTranslations("work.automations");
  const value = action.personId ? `person:${action.personId}` : (action.to ?? "");
  return (
    <Select aria-label={t("person")} value={value} onChange={(event) => (event.target.value.startsWith("person:") ? onChange({ personId: event.target.value.slice(7), to: undefined }) : onChange({ to: event.target.value || undefined, personId: undefined }))}>
      <option value="">—</option>
      <optgroup label={t("rolesGroup")}>
        {roles.map((role) => (
          <option key={role} value={role}>
            {t(`roles.${role.replace("role:", "")}`)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("peopleGroup")}>
        {options.people.map((person) => (
          <option key={person.id} value={`person:${person.id}`}>
            {person.fullName}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

function ActionFields({ action, options, quota, onChange }: { action: AutomationAction; options: AutomationOptions; quota: boolean; onChange: (patch: Partial<AutomationAction>) => void }) {
  const t = useTranslations("work.automations");
  const pick = (items: Named[], key: "stateId" | "labelId" | "templateId", label: string) => (
    <Select aria-label={label} value={action[key] ?? ""} onChange={(event) => onChange({ [key]: event.target.value || undefined })}>
      <option value="">—</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </Select>
  );
  const text = (
    <Input aria-label={t("text")} value={action.text ?? ""} maxLength={500} placeholder={t("textPlaceholder")} onChange={(event) => onChange({ text: event.target.value })} />
  );
  switch (action.type) {
    case "move_state":
      return pick(options.states, "stateId", t("state"));
    case "add_label":
      return pick(options.labels, "labelId", t("label"));
    case "create_task":
      return options.templates.length ? pick(options.templates, "templateId", t("template")) : <p className="text-xs text-muted-foreground">{t("noTemplates")}</p>;
    case "assign":
      return <PersonChoice action={action} roles={ROLES_FOR.assign} options={options} onChange={onChange} />;
    case "add_follower":
      return <PersonChoice action={action} roles={ROLES_FOR.add_follower} options={options} onChange={onChange} />;
    case "request_review":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <PersonChoice action={action} roles={ROLES_FOR.request_review} options={options} onChange={onChange} />
          {text}
        </div>
      );
    case "notify":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <PersonChoice action={action} roles={quota ? ["role:lead"] : ROLES_FOR.notify} options={options} onChange={onChange} />
          {text}
        </div>
      );
    case "comment":
      return text;
    case "set_due":
      return (
        <label className="flex items-center gap-2 text-sm">
          <Input type="number" min={0} max={90} value={action.days ?? 0} onChange={(event) => onChange({ days: Math.max(0, Number(event.target.value) || 0) })} className="w-24" />
          {t("workingDaysFromToday")}
        </label>
      );
    default:
      return null;
  }
}
