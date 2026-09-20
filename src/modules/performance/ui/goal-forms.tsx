"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createCheckInAction, createGoalAction, moveGoalAction, removeKeyResultAction, reparentGoalAction, saveKeyResultAction, updateGoalAction } from "../actions";
import { CONFIDENCES, type GoalLevel, isAnnual, levelRank, METRIC_TYPES, type MetricType, metricValueText, type Milestone, periodsOfYear } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";
type Option = { id: string; name: string };
export type ParentOption = { id: string; title: string; level: GoalLevel; periodKey: string; unitName: string | null };
export type GoalFormChoices = { levels: GoalLevel[]; entities: Option[]; departments: Option[]; teams: Option[]; people: Option[]; owners: Option[] };

const fitsAsParent = (parent: ParentOption, level: GoalLevel, periodKey: string) => levelRank(parent.level) <= levelRank(level) && (isAnnual(parent.periodKey) || parent.periodKey === periodKey);

function ParentSelect({ parents, level, periodKey, defaultValue }: { parents: ParentOption[]; level: GoalLevel; periodKey: string; defaultValue: string }) {
  const t = useTranslations("performance");
  return (
    <Select id="parentGoalId" name="parentGoalId" defaultValue={defaultValue} key={`${level}:${periodKey}`}>
      <option value="">{t("form.noParent")}</option>
      {parents
        .filter((parent) => fitsAsParent(parent, level, periodKey))
        .map((parent) => (
          <option key={parent.id} value={parent.id}>
            {`${t(`enums.level.${parent.level}`)}${parent.unitName ? ` · ${parent.unitName}` : ""} — ${parent.title} (${parent.periodKey})`}
          </option>
        ))}
    </Select>
  );
}

export function NewGoalForm({ year, choices, parents, defaults }: { year: number; choices: GoalFormChoices; parents: ParentOption[]; defaults: { level: GoalLevel; parentGoalId: string; personId: string; ownerPersonId: string } }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(createGoalAction, { onSuccess: (data) => router.push(`/performance/goals/${data.id}`) });
  const [level, setLevel] = useState<GoalLevel>(defaults.level);
  const [periodKey, setPeriodKey] = useState(String(year));
  const select = (name: string, label: string, options: Option[], defaultValue = "", blank?: string) => (
    <Field name={name} label={label}>
      <Select id={name} name={name} defaultValue={defaultValue} required={blank === undefined}>
        {blank === undefined ? null : <option value="">{blank}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form onSubmit={form.onSubmit} className="flex max-w-2xl flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="level" label={t("form.level")}>
            <Select id="level" name="level" value={level} onChange={(event) => setLevel(event.target.value as GoalLevel)}>
              {choices.levels.map((option) => (
                <option key={option} value={option}>
                  {t(`enums.level.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="periodKey" label={t("form.period")}>
            <Select id="periodKey" name="periodKey" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>
              {periodsOfYear(year).map((option) => (
                <option key={option} value={option}>
                  {isAnnual(option) ? t("period.annual", { year }) : t("period.quarter", { quarter: option.slice(-1), year })}
                </option>
              ))}
            </Select>
          </Field>
          {level === "entity" ? select("entityId", t("form.entity"), choices.entities) : null}
          {level === "department" ? select("departmentId", t("form.department"), choices.departments) : null}
          {level === "team" ? select("teamId", t("form.team"), choices.teams) : null}
          {level === "department" || level === "team" ? select("entityId", t("form.forEntity"), choices.entities, "", t("form.everyEntity")) : null}
          {level === "individual" ? select("personId", t("form.person"), choices.people, defaults.personId) : select("ownerPersonId", t("form.owner"), choices.owners, defaults.ownerPersonId)}
        </div>
        <Field name="title" label={t("form.title")}>
          <Input id="title" name="title" required maxLength={200} />
        </Field>
        <Field name="description" label={t("form.description")}>
          <textarea id="description" name="description" rows={3} maxLength={4000} className={textarea} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field name="parentGoalId" label={t("form.parent")}>
              <ParentSelect parents={parents} level={level} periodKey={periodKey} defaultValue={defaults.parentGoalId} />
            </Field>
          </div>
          <Field name="weight" label={t("form.weight")}>
            <Input id="weight" name="weight" type="number" min={1} max={100} defaultValue={1} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("form.weightHint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="activate" defaultChecked /> {t("form.activate")}
        </label>
      </FieldErrors>
      <FormError namespace="performance.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}

export function EditGoalForm({ goal, owners }: { goal: { id: string; title: string; description: string | null; periodKey: string; year: number; weight: number; ownerPersonId: string; level: GoalLevel }; owners: Option[] }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(updateGoalAction, { extra: { goalId: goal.id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("form.title")}>
          <Input id="title" name="title" defaultValue={goal.title} required maxLength={200} />
        </Field>
        <Field name="description" label={t("form.description")}>
          <textarea id="description" name="description" rows={3} maxLength={4000} defaultValue={goal.description ?? ""} className={textarea} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="periodKey" label={t("form.period")}>
            <Select id="periodKey" name="periodKey" defaultValue={goal.periodKey}>
              {periodsOfYear(goal.year).map((option) => (
                <option key={option} value={option}>
                  {isAnnual(option) ? t("period.annual", { year: goal.year }) : t("period.quarter", { quarter: option.slice(-1), year: goal.year })}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="weight" label={t("form.weight")}>
            <Input id="weight" name="weight" type="number" min={1} max={100} defaultValue={goal.weight} />
          </Field>
          {goal.level === "individual" ? (
            <input type="hidden" name="ownerPersonId" value={goal.ownerPersonId} />
          ) : (
            <Field name="ownerPersonId" label={t("form.owner")}>
              <Select id="ownerPersonId" name="ownerPersonId" defaultValue={goal.ownerPersonId}>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </FieldErrors>
      <FormError namespace="performance.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("form.save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("form.saved")}</span> : null}
      </div>
    </form>
  );
}

export function ReparentForm({ goal, parents }: { goal: { id: string; level: GoalLevel; periodKey: string; parentGoalId: string | null }; parents: ParentOption[] }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(reparentGoalAction, { extra: { goalId: goal.id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-2">
      <Field name="parentGoalId" label={t("form.parent")}>
        <ParentSelect parents={parents.filter((parent) => parent.id !== goal.id)} level={goal.level} periodKey={goal.periodKey} defaultValue={goal.parentGoalId ?? ""} />
      </Field>
      <FormError namespace="performance.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={form.pending}>
          {t("form.align")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("form.saved")}</span> : null}
      </div>
    </form>
  );
}

type Move = "activate" | "close" | "cancel" | "reopen";

export function GoalMoves({ goalId, moves }: { goalId: string; moves: Move[] }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const run = (move: Move) => {
    if ((move === "close" || move === "cancel") && !window.confirm(t(`moves.${move}Confirm`))) return;
    startTransition(async () => {
      const result = await moveGoalAction({ goalId, move, reason });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) router.refresh();
    });
  };
  if (moves.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {moves.includes("reopen") ? <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("moves.reason")} maxLength={500} className="max-w-xs" aria-label={t("moves.reason")} /> : null}
        {moves.map((move) => (
          <Button key={move} type="button" size="sm" variant={move === "activate" || move === "close" ? "default" : "outline"} disabled={pending || (move === "reopen" && reason.trim() === "")} onClick={() => run(move)}>
            {t(`moves.${move}`)}
          </Button>
        ))}
      </div>
      <FormError namespace="performance.errors" errorKey={errorKey} />
    </div>
  );
}

export type KeyResultFormValue = { id: string | null; title: string; metricType: MetricType; startValue: number; targetValue: number; milestones: Milestone[] | null; weight: number; hasCheckIns: boolean };

export function KeyResultForm({ goalId, value }: { goalId: string; value: KeyResultFormValue }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const [metricType, setMetricType] = useState<MetricType>(value.metricType);
  const [formKey, setFormKey] = useState(0);
  const form = useActionForm(saveKeyResultAction, {
    extra: { goalId, keyResultId: value.id ?? "" },
    onSuccess: () => {
      // A new key result's form starts over; an edited one keeps what was typed.
      if (!value.id) setFormKey((key) => key + 1);
      router.refresh();
    },
  });
  return (
    <form key={formKey} onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Field name="title" label={t("kr.title")}>
              <Input id="title" name="title" defaultValue={value.title} required maxLength={200} />
            </Field>
          </div>
          <Field name="metricType" label={t("kr.metricType")}>
            {/* Its history was recorded in one unit: the type is fixed after the first check-in. */}
            {value.hasCheckIns ? <input type="hidden" name="metricType" value={metricType} /> : null}
            <Select id="metricType" name={value.hasCheckIns ? undefined : "metricType"} value={metricType} disabled={value.hasCheckIns} onChange={(event) => setMetricType(event.target.value as MetricType)}>
              {METRIC_TYPES.map((option) => (
                <option key={option} value={option}>
                  {t(`enums.metric.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="weight" label={t("form.weight")}>
            <Input id="weight" name="weight" type="number" min={1} max={100} defaultValue={value.weight} />
          </Field>
        </div>
        {metricType === "milestone" ? (
          <Field name="milestones" label={t("kr.milestones")}>
            <textarea id="milestones" name="milestones" rows={4} maxLength={2000} defaultValue={(value.milestones ?? []).map((milestone) => milestone.title).join("\n")} className={textarea} required />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="startValue" label={t("kr.start")}>
              <Input id="startValue" name="startValue" inputMode="decimal" defaultValue={value.metricType === "milestone" ? "0" : metricValueText(value.metricType, value.startValue)} required />
            </Field>
            <Field name="targetValue" label={t("kr.target")}>
              <Input id="targetValue" name="targetValue" inputMode="decimal" defaultValue={value.metricType === "milestone" || !value.id ? "" : metricValueText(value.metricType, value.targetValue)} required />
            </Field>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t(metricType === "milestone" ? "kr.milestonesHint" : "kr.valueHint")}</p>
      </FieldErrors>
      <FormError namespace="performance.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant={value.id ? "outline" : "default"} disabled={form.pending}>
          {value.id ? t("form.save") : t("kr.add")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("form.saved")}</span> : null}
      </div>
    </form>
  );
}

export function RemoveKeyResultButton({ keyResultId }: { keyResultId: string }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(t("kr.removeConfirm"))) return;
          startTransition(async () => {
            const result = await removeKeyResultAction({ keyResultId });
            setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
            if (result.ok) router.refresh();
          });
        }}
      >
        {t("kr.remove")}
      </Button>
      <FormError namespace="performance.errors" errorKey={errorKey} />
    </span>
  );
}

export type CheckInTarget = { id: string; metricType: MetricType; currentValue: number; milestones: Milestone[] | null; confidence: string | null };

/** The weekly check-in for one key result: where it stands now, how confident, a note. */
export function CheckInForm({ keyResult }: { keyResult: CheckInTarget }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(createCheckInAction, { extra: { keyResultId: keyResult.id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={form.fieldErrors}>
        {keyResult.metricType === "milestone" ? (
          <fieldset className="flex flex-col gap-1 text-sm">
            {(keyResult.milestones ?? []).map((milestone, index) => (
              <label key={index} className="flex items-center gap-2">
                <input type="checkbox" name="doneMilestones[]" value={index} defaultChecked={milestone.done} /> {milestone.title}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-4">
          {keyResult.metricType === "milestone" ? null : (
            <Field name="value" label={t("checkIn.value")}>
              <Input id="value" name="value" inputMode="decimal" defaultValue={metricValueText(keyResult.metricType, keyResult.currentValue)} required />
            </Field>
          )}
          <Field name="confidence" label={t("checkIn.confidence")}>
            <Select id="confidence" name="confidence" defaultValue={keyResult.confidence ?? "on_track"}>
              {CONFIDENCES.map((option) => (
                <option key={option} value={option}>
                  {t(`enums.confidence.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field name="note" label={t("checkIn.note")}>
              <Input id="note" name="note" maxLength={1000} />
            </Field>
          </div>
        </div>
      </FieldErrors>
      <FormError namespace="performance.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("checkIn.submit")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("checkIn.saved")}</span> : null}
      </div>
    </form>
  );
}
