"use client";
// The forms of the plan pages. Each posts to one server action, which re-checks access; the page
// decides which forms to show. Mobile first: fields stack on a phone and sit in a row from `sm`.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { CHANNELS, CONTENT_FORMATS } from "../../work/enums";
import { cancelDeliverableAction, createLineTasksAction, deleteMilestoneAction, deletePhaseAction, linkTaskAction, postStatusUpdateAction, rebaselineAction, saveDeliverableAction, saveMilestoneAction, savePhaseAction, setAccountManagerAction, setFeeAction, setMilestoneDoneAction, submitBriefAction, unlinkTaskAction, updateBriefAction, updatePlanSettingsAction } from "../actions";

type Person = { id: string; fullName: string };
type Named = { id: string; name: string };
type Action = (input: unknown) => Promise<ActionResult<unknown>>;

const textarea = "min-h-20 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm";
const hoursOf = (minutes: number | null | undefined) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : "");

/** A form that posts to an action and shows what went wrong in the project's own words. */
export function ActionForm({ action, extra, children, submit, className, onDone }: { action: Action; extra?: Record<string, unknown>; children: ReactNode; submit: string; className?: string; onDone?: () => void }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(action, {
    extra,
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className={className ?? "flex flex-col gap-3"}>
      <FieldErrors value={fieldErrors}>{children}</FieldErrors>
      <FormError namespace="projects.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {submit}
        </Button>
        {saved && !errorKey ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

/** One tap, one action: mark done, remove, cancel a line. */
export function ActionButton({ action, input, label, confirm, variant = "outline" }: { action: Action; input: unknown; label: string; confirm?: string; variant?: "outline" | "ghost" | "default" }) {
  const t = useTranslations("projects.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action(input);
            const key = result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic");
            setError(key);
            if (result.ok) router.refresh();
          });
        }}
      >
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t.has(error) ? t(error) : t("generic")}
        </span>
      ) : null}
    </span>
  );
}

// ── Overview: brief, kick-off, settings ─────────────────────────────────────────────────────

export type BriefValues = { objective?: string; scopeIn?: string; scopeOut?: string; successCriteria?: string; assumptions?: string; audience?: string; keyMessages?: string; clientContacts?: { name: string; role?: string; contact?: string }[]; links?: string[] };

export function BriefForm({ projectId, brief, kind }: { projectId: string; brief: BriefValues; kind: string }) {
  const t = useTranslations("projects.brief");
  const area = (name: keyof BriefValues, rows = 3) => (
    <Field name={name} label={t(`fields.${name}`)}>
      <textarea id={name} name={name} rows={rows} maxLength={4000} defaultValue={(brief[name] as string | undefined) ?? ""} placeholder={t.has(`hints.${kind}.${name}`) ? t(`hints.${kind}.${name}` as "hints.client.objective") : undefined} className={textarea} />
    </Field>
  );
  return (
    <ActionForm action={updateBriefAction} extra={{ projectId }} submit={t("save")}>
      {area("objective")}
      <div className="grid gap-3 sm:grid-cols-2">
        {area("scopeIn", 4)}
        {area("scopeOut", 4)}
      </div>
      {area("successCriteria")}
      <div className="grid gap-3 sm:grid-cols-2">
        {area("audience", 2)}
        {area("keyMessages", 2)}
      </div>
      {area("assumptions", 2)}
      <Field name="clientContacts" label={t("fields.clientContacts")}>
        <textarea id="clientContacts" name="clientContacts" rows={3} defaultValue={(brief.clientContacts ?? []).map((contact) => [contact.name, contact.role, contact.contact].filter(Boolean).join(" — ")).join("\n")} placeholder={t("contactsHint")} className={textarea} />
      </Field>
      <Field name="links" label={t("fields.links")}>
        <textarea id="links" name="links" rows={2} defaultValue={(brief.links ?? []).join("\n")} placeholder="https://drive.google.com/…" className={`${textarea} font-mono`} />
      </Field>
    </ActionForm>
  );
}

export function SubmitBriefButton({ projectId, resubmit }: { projectId: string; resubmit: boolean }) {
  const t = useTranslations("projects.brief");
  return <ActionButton action={submitBriefAction} input={{ projectId }} label={resubmit ? t("resubmit") : t("submit")} variant="default" />;
}

export function PlanSettingsForm({ projectId, values, kinds }: { projectId: string; values: { kind: string; budgetMinutes: number | null; budgetByRole: { role: string; minutes: number }[]; updateCadenceDays: number; driveUrl: string | null }; kinds: readonly string[] }) {
  const t = useTranslations("projects");
  const roles = [...values.budgetByRole, { role: "", minutes: 0 }, { role: "", minutes: 0 }];
  return (
    <ActionForm action={updatePlanSettingsAction} extra={{ projectId }} submit={t("settings.save")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="kind" label={t("fields.kind")}>
          <Select id="kind" name="kind" defaultValue={values.kind}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind as "client"}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="updateCadenceDays" label={t("fields.updateCadenceDays")}>
          <Input id="updateCadenceDays" name="updateCadenceDays" type="number" min={1} max={60} defaultValue={values.updateCadenceDays} />
        </Field>
        <Field name="budgetHours" label={t("fields.budgetHours")}>
          <Input id="budgetHours" name="budgetHours" type="number" min={0} step="0.5" defaultValue={hoursOf(values.budgetMinutes)} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("settings.byRole")}</legend>
        <p className="text-xs text-muted-foreground">{t("settings.byRoleHint")}</p>
        {roles.map((role, index) => (
          <div key={index} className="grid grid-cols-[1fr_7rem] gap-2">
            <Input name={`roles.${index}.role`} defaultValue={role.role} maxLength={60} placeholder={t("settings.rolePlaceholder")} aria-label={t("settings.role")} />
            <Input name={`roles.${index}.hours`} type="number" min={0} step="0.5" defaultValue={hoursOf(role.minutes)} aria-label={t("fields.budgetHours")} />
          </div>
        ))}
      </fieldset>
      <Field name="driveUrl" label={t("fields.driveUrl")}>
        <Input id="driveUrl" name="driveUrl" type="url" defaultValue={values.driveUrl ?? ""} placeholder="https://drive.google.com/…" />
      </Field>
    </ActionForm>
  );
}

export function AccountManagerForm({ projectId, current, people }: { projectId: string; current: string | null; people: Person[] }) {
  const t = useTranslations("projects");
  return (
    <ActionForm action={setAccountManagerAction} extra={{ projectId }} submit={t("settings.save")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field name="personId" label={t("fields.accountManager")}>
        <Select id="personId" name="personId" defaultValue={current ?? ""} className="sm:w-64">
          <option value="">{t("settings.noAccountManager")}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </ActionForm>
  );
}

export function FeeForm({ projectId, feeVnd }: { projectId: string; feeVnd: number | null }) {
  const t = useTranslations("projects");
  return (
    <ActionForm action={setFeeAction} extra={{ projectId }} submit={t("settings.save")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field name="feeVnd" label={t("fields.feeVnd")}>
        <Input id="feeVnd" name="feeVnd" inputMode="numeric" defaultValue={feeVnd ?? ""} placeholder="120000000" className="sm:w-56" />
      </Field>
    </ActionForm>
  );
}

// ── Plan: phases and milestones ─────────────────────────────────────────────────────────────

export function PhaseForm({ projectId, phase, onDone }: { projectId: string; phase?: { id: string; name: string; startDate: string | null; endDate: string | null; budgetMinutes: number | null; sortOrder: number }; onDone?: () => void }) {
  const t = useTranslations("projects");
  const id = phase?.id ?? "new";
  return (
    <ActionForm action={savePhaseAction} extra={{ projectId, phaseId: phase?.id ?? null }} submit={phase ? t("settings.save") : t("plan.addPhase")} onDone={onDone} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_6rem_4rem_auto] sm:items-end">
      <Field name="name" label={t("fields.phase")}>
        <Input id={`phase-name-${id}`} name="name" required maxLength={120} defaultValue={phase?.name ?? ""} />
      </Field>
      <Field name="startDate" label={t("fields.startDate")}>
        <Input id={`phase-start-${id}`} name="startDate" type="date" defaultValue={phase?.startDate ?? ""} />
      </Field>
      <Field name="endDate" label={t("fields.endDate")}>
        <Input id={`phase-end-${id}`} name="endDate" type="date" defaultValue={phase?.endDate ?? ""} />
      </Field>
      <Field name="budgetHours" label={t("fields.budgetHours")}>
        <Input id={`phase-budget-${id}`} name="budgetHours" type="number" min={0} step="0.5" defaultValue={hoursOf(phase?.budgetMinutes)} />
      </Field>
      <Field name="sortOrder" label={t("fields.order")}>
        <Input id={`phase-order-${id}`} name="sortOrder" type="number" min={0} defaultValue={phase?.sortOrder ?? 0} />
      </Field>
    </ActionForm>
  );
}

export function MilestoneForm({ projectId, milestone, phases, people, showAmount }: { projectId: string; milestone?: { id: string; name: string; dueDate: string | null; phaseId: string | null; ownerPersonId: string | null; isClientFacing: boolean; isBilling: boolean; billingAmountVnd?: number | null; sortOrder: number }; phases: Named[]; people: Person[]; showAmount: boolean }) {
  const t = useTranslations("projects");
  const id = milestone?.id ?? "new";
  return (
    <ActionForm action={saveMilestoneAction} extra={{ projectId, milestoneId: milestone?.id ?? null }} submit={milestone ? t("settings.save") : t("plan.addMilestone")}>
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem_12rem]">
        <Field name="name" label={t("fields.milestone")}>
          <Input id={`ms-name-${id}`} name="name" required maxLength={160} defaultValue={milestone?.name ?? ""} />
        </Field>
        <Field name="dueDate" label={t("fields.dueDate")}>
          <Input id={`ms-due-${id}`} name="dueDate" type="date" defaultValue={milestone?.dueDate ?? ""} />
        </Field>
        <Field name="ownerPersonId" label={t("fields.owner")}>
          <Select id={`ms-owner-${id}`} name="ownerPersonId" defaultValue={milestone?.ownerPersonId ?? ""}>
            <option value="">—</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <Field name="phaseId" label={t("fields.phase")}>
          <Select id={`ms-phase-${id}`} name="phaseId" defaultValue={milestone?.phaseId ?? ""} className="w-48">
            <option value="">—</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isClientFacing" defaultChecked={milestone?.isClientFacing} /> {t("fields.isClientFacing")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isBilling" defaultChecked={milestone?.isBilling} /> {t("fields.isBilling")}
        </label>
        {showAmount ? (
          <Field name="billingAmountVnd" label={t("fields.billingAmountVnd")}>
            <Input id={`ms-amount-${id}`} name="billingAmountVnd" inputMode="numeric" defaultValue={milestone?.billingAmountVnd ?? ""} className="w-44" />
          </Field>
        ) : null}
        <Field name="sortOrder" label={t("fields.order")}>
          <Input id={`ms-order-${id}`} name="sortOrder" type="number" min={0} defaultValue={milestone?.sortOrder ?? 0} className="w-20" />
        </Field>
      </div>
    </ActionForm>
  );
}

export function MilestoneTools({ milestoneId, done }: { milestoneId: string; done: boolean }) {
  const t = useTranslations("projects.plan");
  return (
    <span className="flex flex-wrap gap-2">
      <ActionButton action={setMilestoneDoneAction} input={{ milestoneId, done: !done }} label={done ? t("reopen") : t("markDone")} />
      <ActionButton action={deleteMilestoneAction} input={{ milestoneId }} label={t("remove")} confirm={t("removeConfirm")} variant="ghost" />
    </span>
  );
}

export function RemovePhaseButton({ phaseId }: { phaseId: string }) {
  const t = useTranslations("projects.plan");
  return <ActionButton action={deletePhaseAction} input={{ phaseId }} label={t("remove")} confirm={t("removeConfirm")} variant="ghost" />;
}

/** Links a task of the project to what it works towards. Empty selects unlink it. */
export function LinkTaskForm({ tasks, milestones, lines, phases }: { tasks: { id: string; key: string; title: string }[]; milestones: Named[]; lines: Named[]; phases: Named[] }) {
  const t = useTranslations("projects");
  const pick = (name: string, label: string, options: Named[]) => (
    <Field name={name} label={label}>
      <Select id={`link-${name}`} name={name} defaultValue="">
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{t("plan.nothingToLink")}</p>;
  return (
    <ActionForm action={linkTaskAction} submit={t("plan.link")}>
      <Field name="taskId" label={t("fields.task")}>
        <Select id="link-taskId" name="taskId" required defaultValue="">
          <option value="" disabled>
            {t("plan.pickTask")}
          </option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.key} · {task.title}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        {pick("milestoneId", t("fields.milestone"), milestones)}
        {pick("deliverableId", t("fields.deliverable"), lines)}
        {pick("phaseId", t("fields.phase"), phases)}
      </div>
    </ActionForm>
  );
}

export function UnlinkButton({ taskId }: { taskId: string }) {
  const t = useTranslations("projects.plan");
  return <ActionButton action={unlinkTaskAction} input={{ taskId }} label={t("unlink")} variant="ghost" />;
}

// ── Deliverables register ───────────────────────────────────────────────────────────────────

export function DeliverableForm({ projectId, line, milestones }: { projectId: string; line?: { id: string; title: string; quantity: number; format: string | null; channel: string | null; dueDate: string | null; milestoneId: string | null; sortOrder: number }; milestones: Named[] }) {
  const t = useTranslations("projects");
  const tWork = useTranslations("work");
  const id = line?.id ?? "new";
  return (
    <ActionForm action={saveDeliverableAction} extra={{ projectId, deliverableId: line?.id ?? null }} submit={line ? t("settings.save") : t("register.add")}>
      <div className="grid gap-2 sm:grid-cols-[5rem_1fr]">
        <Field name="quantity" label={t("fields.quantity")}>
          <Input id={`line-qty-${id}`} name="quantity" type="number" min={1} max={1000} required defaultValue={line?.quantity ?? 1} />
        </Field>
        <Field name="title" label={t("fields.deliverable")}>
          <Input id={`line-title-${id}`} name="title" required maxLength={200} defaultValue={line?.title ?? ""} placeholder={t("register.titleHint")} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field name="format" label={t("fields.format")}>
          <Select id={`line-format-${id}`} name="format" defaultValue={line?.format ?? ""}>
            <option value="">—</option>
            {CONTENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {tWork(`formats.${format}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="channel" label={t("fields.channel")}>
          <Select id={`line-channel-${id}`} name="channel" defaultValue={line?.channel ?? ""}>
            <option value="">—</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {tWork(`channels.${channel}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="milestoneId" label={t("fields.milestone")}>
          <Select id={`line-ms-${id}`} name="milestoneId" defaultValue={line?.milestoneId ?? ""}>
            <option value="">—</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="dueDate" label={t("fields.dueDate")}>
          <Input id={`line-due-${id}`} name="dueDate" type="date" defaultValue={line?.dueDate ?? ""} />
        </Field>
      </div>
      <input type="hidden" name="sortOrder" value={line?.sortOrder ?? 0} />
    </ActionForm>
  );
}

export function CancelLineButton({ deliverableId, cancelled }: { deliverableId: string; cancelled: boolean }) {
  const t = useTranslations("projects.register");
  return <ActionButton action={cancelDeliverableAction} input={{ deliverableId, cancelled: !cancelled }} label={cancelled ? t("restore") : t("cancel")} confirm={cancelled ? undefined : t("cancelConfirm")} variant="ghost" />;
}

export function LineTasksForm({ deliverableId, missing, people }: { deliverableId: string; missing: number; people: Person[] }) {
  const t = useTranslations("projects.register");
  return (
    <ActionForm action={createLineTasksAction} extra={{ deliverableId }} submit={t("createTasks")} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <Field name="count" label={t("count")}>
        <Input id={`count-${deliverableId}`} name="count" type="number" min={1} max={50} required defaultValue={Math.min(50, Math.max(1, missing))} className="sm:w-20" />
      </Field>
      <Field name="assigneePersonId" label={t("assignee")}>
        <Select id={`assignee-${deliverableId}`} name="assigneePersonId" defaultValue="" className="sm:w-52">
          <option value="">—</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="dueDate" label={t("due")}>
        <Input id={`due-${deliverableId}`} name="dueDate" type="date" className="sm:w-40" />
      </Field>
    </ActionForm>
  );
}

// ── Status updates ──────────────────────────────────────────────────────────────────────────

/**
 * `draft` is the assistant's drafting button (FR-PJM-64), mounted by the page: it fills the summary
 * (`#summary`) and puts the health the facts suggest into the hidden select `#status-health-draft`,
 * which ticks the matching choice here. Nothing is posted until the lead posts it.
 */
export function StatusUpdateForm({ projectId, healths, draft }: { projectId: string; healths: readonly string[]; draft?: ReactNode }) {
  const t = useTranslations("projects");
  const [key, setKey] = useState(0);
  const [health, setHealth] = useState<string | null>(null);
  return (
    <ActionForm
      key={key}
      action={postStatusUpdateAction}
      extra={{ projectId }}
      submit={t("updates.post")}
      onDone={() => {
        setKey((value) => value + 1);
        setHealth(null);
      }}
    >
      {draft ? (
        <div className="flex flex-col gap-1">
          {draft}
          <select id="status-health-draft" hidden aria-hidden tabIndex={-1} value={health ?? ""} onChange={(event) => setHealth(event.target.value || null)}>
            <option value="" />
            {healths.map((value) => (
              <option key={value} value={value} />
            ))}
          </select>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">{t("fields.health")}</legend>
        <div className="flex flex-wrap gap-3">
          {healths.map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm has-checked:bg-muted">
              <input type="radio" name="health" value={value} required checked={health === value} onChange={() => setHealth(value)} /> {t(`health.${value as "on_track"}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field name="summary" label={t("fields.summary")}>
        <textarea id="summary" name="summary" required rows={3} maxLength={4000} className={textarea} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="highlights" label={t("fields.highlights")}>
          <textarea id="highlights" name="highlights" rows={3} maxLength={4000} className={textarea} />
        </Field>
        <Field name="nextSteps" label={t("fields.nextSteps")}>
          <textarea id="nextSteps" name="nextSteps" rows={3} maxLength={4000} className={textarea} />
        </Field>
      </div>
    </ActionForm>
  );
}

// ── Baselines (FR-PJM-12) ───────────────────────────────────────────────────────────────────

/** Re-baselining asks why: the reason goes into the audit record beside the baseline it replaces. */
export function RebaselineForm({ projectId }: { projectId: string }) {
  const t = useTranslations("projects.baseline");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t("rebaseline")}</summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-xs text-muted-foreground">{t("rebaselineHint")}</p>
        <ActionForm action={rebaselineAction} extra={{ projectId }} submit={t("rebaselineSubmit")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field name="reason" label={t("reason")}>
            <Input id="rebaseline-reason" name="reason" required maxLength={1000} placeholder={t("reasonHint")} className="sm:w-96" />
          </Field>
        </ActionForm>
      </div>
    </details>
  );
}
