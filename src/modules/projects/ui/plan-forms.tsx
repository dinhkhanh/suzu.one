"use client";
// The forms of the plan pages. Each posts to one server action, which re-checks access; the page
// decides which forms to show. Mobile first: fields stack on a phone and sit in a row from `sm`.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ActionResult } from "@/lib/action";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { CHANNELS, CONTENT_FORMATS } from "../../work/client";
import {
  cancelDeliverableAction,
  createLineTasksAction,
  deleteMilestoneAction,
  deletePhaseAction,
  linkTaskAction,
  postStatusUpdateAction,
  rebaselineAction,
  reopenProjectAction,
  saveDeliverableAction,
  saveMilestoneAction,
  savePhaseAction,
  setAccountManagerAction,
  setFeeAction,
  setMilestoneDoneAction,
  submitBriefAction,
  unlinkTaskAction,
  updateBriefAction,
  updateBriefContactsAction,
  updatePlanSettingsAction,
} from "../actions";

type Person = { id: string; fullName: string };
type Named = { id: string; name: string };
type Action = (input: unknown) => Promise<ActionResult<unknown>>;

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
  const run = () =>
    startTransition(async () => {
      const result = await action(input);
      const key = result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic");
      setError(key);
      if (result.ok) router.refresh();
    });
  return (
    <span className="inline-flex items-center gap-2">
      {confirm ? (
        <ConfirmButton size="xs" variant={variant} disabled={pending} label={label} question={confirm} onConfirm={run} />
      ) : (
        <Button type="button" size="xs" variant={variant} disabled={pending} onClick={run}>
          {label}
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t.has(error) ? t(error) : t("generic")}
        </span>
      ) : null}
    </span>
  );
}

// ── Overview: brief, kick-off, settings ─────────────────────────────────────────────────────

export type BriefValues = {
  objective?: string;
  scopeIn?: string;
  scopeOut?: string;
  successCriteria?: string;
  assumptions?: string;
  audience?: string;
  keyMessages?: string;
  clientContacts?: { name: string; role?: string; contact?: string }[];
  links?: string[];
};

/** `accountContacts`: the account's contacts (FR-CRM-46), put in the contacts field while the brief names none. */
export function BriefForm({ projectId, brief, kind, accountContacts = [] }: { projectId: string; brief: BriefValues; kind: string; accountContacts?: { name: string; title: string | null }[] }) {
  const contacts = brief.clientContacts?.length ? brief.clientContacts : accountContacts.map((contact) => ({ name: contact.name, role: contact.title ?? undefined }));
  const t = useTranslations("projects.brief");
  const area = (name: keyof BriefValues, rows = 3) => (
    <Field name={name} label={t(`fields.${name}`)}>
      <NoteEditor
        id={name}
        name={name}
        rows={rows}
        maxLength={4000}
        defaultValue={(brief[name] as string | undefined) ?? ""}
        placeholder={t.has(`hints.${kind}.${name}`) ? t(`hints.${kind}.${name}` as "hints.client.objective") : undefined}
      />
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
        <Textarea
          id="clientContacts"
          name="clientContacts"
          rows={3}
          defaultValue={contacts.map((contact: { name: string; role?: string; contact?: string }) => [contact.name, contact.role, contact.contact].filter(Boolean).join(" — ")).join("\n")}
          placeholder={t("contactsHint")}
        />
      </Field>
      <Field name="links" label={t("fields.links")}>
        <Textarea id="links" name="links" rows={2} defaultValue={(brief.links ?? []).join("\n")} placeholder="https://drive.google.com/…" className="font-mono" />
      </Field>
    </ActionForm>
  );
}

const contactLines = (contacts: readonly { name: string; role?: string; contact?: string }[]) => contacts.map((contact) => [contact.name, contact.role, contact.contact].filter(Boolean).join(" — ")).join("\n");

/** An approved brief's contacts and links — the two parts of it that stay editable (FR-PJM-03). */
export function BriefContactsForm({ projectId, brief }: { projectId: string; brief: Pick<BriefValues, "clientContacts" | "links"> }) {
  const t = useTranslations("projects.brief");
  return (
    <ActionForm action={updateBriefContactsAction} extra={{ projectId }} submit={t("saveContacts")}>
      <Field name="clientContacts" label={t("fields.clientContacts")}>
        <Textarea id="clientContacts" name="clientContacts" rows={3} defaultValue={contactLines(brief.clientContacts ?? [])} placeholder={t("contactsHint")} />
      </Field>
      <Field name="links" label={t("fields.links")}>
        <Textarea id="links" name="links" rows={2} defaultValue={(brief.links ?? []).join("\n")} placeholder="https://drive.google.com/…" className="font-mono" />
      </Field>
    </ActionForm>
  );
}

export function SubmitBriefButton({ projectId, resubmit }: { projectId: string; resubmit: boolean }) {
  const t = useTranslations("projects.brief");
  return <ActionButton action={submitBriefAction} input={{ projectId }} label={resubmit ? t("resubmit") : t("submit")} variant="default" />;
}

/** `scopeLocked`: after the kick-off the total hours budget moves only through a change request — it is shown, not typed; the split between roles stays. */
export function PlanSettingsForm({
  projectId,
  values,
  kinds,
  scopeLocked = false,
}: {
  projectId: string;
  values: { kind: string; budgetMinutes: number | null; budgetByRole: { role: string; minutes: number }[]; updateCadenceDays: number; driveUrl: string | null };
  kinds: readonly string[];
  scopeLocked?: boolean;
}) {
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
          <Input id="budgetHours" name="budgetHours" type="number" min={0} step="0.5" defaultValue={hoursOf(values.budgetMinutes)} readOnly={scopeLocked} />
        </Field>
      </div>
      {scopeLocked ? <p className="text-xs text-muted-foreground">{t("scope.budgetLocked")}</p> : null}
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
        <MoneyInput id="feeVnd" name="feeVnd" defaultValue={feeVnd ?? ""} placeholder="120000000" className="sm:w-56" />
      </Field>
    </ActionForm>
  );
}

// ── Plan: phases and milestones ─────────────────────────────────────────────────────────────

export function PhaseForm({ projectId, phase, onDone }: { projectId: string; phase?: { id: string; name: string; startDate: string | null; endDate: string | null; budgetMinutes: number | null; sortOrder: number }; onDone?: () => void }) {
  const t = useTranslations("projects");
  const id = phase?.id ?? "new";
  return (
    <ActionForm
      action={savePhaseAction}
      extra={{ projectId, phaseId: phase?.id ?? null }}
      submit={phase ? t("settings.save") : t("plan.addPhase")}
      onDone={onDone}
      className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_6rem_4rem_auto] sm:items-end"
    >
      <Field name="name" label={t("fields.phase")}>
        <Input id={`phase-name-${id}`} name="name" required maxLength={120} defaultValue={phase?.name ?? ""} />
      </Field>
      <Field name="startDate" label={t("fields.startDate")}>
        <DatePicker id={`phase-start-${id}`} name="startDate" defaultValue={phase?.startDate ?? ""} />
      </Field>
      <Field name="endDate" label={t("fields.endDate")}>
        <DatePicker id={`phase-end-${id}`} name="endDate" defaultValue={phase?.endDate ?? ""} />
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

export function MilestoneForm({
  projectId,
  milestone,
  phases,
  people,
  showAmount,
}: {
  projectId: string;
  milestone?: { id: string; name: string; dueDate: string | null; phaseId: string | null; ownerPersonId: string | null; isClientFacing: boolean; isBilling: boolean; billingAmountVnd?: number | null; sortOrder: number };
  phases: Named[];
  people: Person[];
  showAmount: boolean;
}) {
  const t = useTranslations("projects");
  const id = milestone?.id ?? "new";
  return (
    <ActionForm action={saveMilestoneAction} extra={{ projectId, milestoneId: milestone?.id ?? null }} submit={milestone ? t("settings.save") : t("plan.addMilestone")}>
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem_12rem]">
        <Field name="name" label={t("fields.milestone")}>
          <Input id={`ms-name-${id}`} name="name" required maxLength={160} defaultValue={milestone?.name ?? ""} />
        </Field>
        <Field name="dueDate" label={t("fields.dueDate")}>
          <DatePicker id={`ms-due-${id}`} name="dueDate" defaultValue={milestone?.dueDate ?? ""} />
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
          <Checkbox name="isClientFacing" defaultChecked={milestone?.isClientFacing} /> {t("fields.isClientFacing")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isBilling" defaultChecked={milestone?.isBilling} /> {t("fields.isBilling")}
        </label>
        {showAmount ? (
          <Field name="billingAmountVnd" label={t("fields.billingAmountVnd")}>
            <MoneyInput id={`ms-amount-${id}`} name="billingAmountVnd" defaultValue={milestone?.billingAmountVnd ?? ""} className="w-44" />
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

/**
 * `scopeLocked`: after the kick-off a line's quantity, format and channel are the promise and move
 * only through a change request — they are shown and posted back unchanged; the wording, the
 * milestone and the due date stay editable.
 */
export function DeliverableForm({
  projectId,
  line,
  milestones,
  scopeLocked = false,
}: {
  projectId: string;
  line?: { id: string; title: string; quantity: number; format: string | null; channel: string | null; dueDate: string | null; milestoneId: string | null; sortOrder: number };
  milestones: Named[];
  scopeLocked?: boolean;
}) {
  const t = useTranslations("projects");
  const tWork = useTranslations("work");
  const id = line?.id ?? "new";
  return (
    <ActionForm
      action={saveDeliverableAction}
      extra={{ projectId, deliverableId: line?.id ?? null, ...(scopeLocked ? { format: line?.format ?? "", channel: line?.channel ?? "" } : {}) }}
      submit={line ? t("settings.save") : t("register.add")}
    >
      {scopeLocked ? <p className="text-xs text-muted-foreground">{t("scope.lineLocked")}</p> : null}
      <div className="grid gap-2 sm:grid-cols-[5rem_1fr]">
        <Field name="quantity" label={t("fields.quantity")}>
          <Input id={`line-qty-${id}`} name="quantity" type="number" min={1} max={1000} required defaultValue={line?.quantity ?? 1} readOnly={scopeLocked} />
        </Field>
        <Field name="title" label={t("fields.deliverable")}>
          <Input id={`line-title-${id}`} name="title" required maxLength={200} defaultValue={line?.title ?? ""} placeholder={t("register.titleHint")} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field name="format" label={t("fields.format")}>
          <Select id={`line-format-${id}`} name={scopeLocked ? undefined : "format"} disabled={scopeLocked} defaultValue={line?.format ?? ""}>
            <option value="">—</option>
            {CONTENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {tWork(`formats.${format}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="channel" label={t("fields.channel")}>
          <Select id={`line-channel-${id}`} name={scopeLocked ? undefined : "channel"} disabled={scopeLocked} defaultValue={line?.channel ?? ""}>
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
          <DatePicker id={`line-due-${id}`} name="dueDate" defaultValue={line?.dueDate ?? ""} />
        </Field>
      </div>
      <input type="hidden" name="sortOrder" value={line?.sortOrder ?? 0} />
    </ActionForm>
  );
}

/** Re-opening a closed project: deliberate, with the reason on record (FR-PJM-59). */
export function ReopenProjectForm({ projectId }: { projectId: string }) {
  const t = useTranslations("projects.close");
  return (
    <ActionForm action={reopenProjectAction} extra={{ projectId }} submit={t("reopen.submit")}>
      <Field name="reason" label={t("reopen.reason")}>
        <Textarea id="reason" name="reason" rows={3} required maxLength={2000} placeholder={t("reopen.reasonHint")} />
      </Field>
      <p className="text-xs text-muted-foreground">{t("reopen.warning")}</p>
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
        <DatePicker id={`due-${deliverableId}`} name="dueDate" className="sm:w-40" />
      </Field>
    </ActionForm>
  );
}

// ── Status updates ──────────────────────────────────────────────────────────────────────────

/**
 * `draft` is the assistant's drafting button (FR-PJM-64), mounted by the page: it fills the summary
 * (`#summary`) and puts the health the facts suggest into the hidden select `#status-health-draft`,
 * which ticks the matching choice here. Nothing is posted until the lead posts it. `initial`: the
 * assistant's proposal the page started from; after a post the form starts empty again.
 */
export function StatusUpdateForm({ projectId, healths, draft, initial }: { projectId: string; healths: readonly string[]; draft?: ReactNode; initial?: { health?: string; summary?: string; highlights?: string; nextSteps?: string } }) {
  const t = useTranslations("projects");
  const [key, setKey] = useState(0);
  const [health, setHealth] = useState<string | null>(initial?.health ?? null);
  const start = key === 0 ? initial : undefined;
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
        <RadioGroup name="health" required value={health ?? ""} onValueChange={(next) => setHealth(String(next))} className="flex flex-wrap gap-3">
          {healths.map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm has-data-checked:bg-muted">
              <RadioGroupItem value={value} /> {t(`health.${value as "on_track"}`)}
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <Field name="summary" label={t("fields.summary")}>
        <NoteEditor id="summary" name="summary" required rows={3} maxLength={4000} defaultValue={start?.summary} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="highlights" label={t("fields.highlights")}>
          <NoteEditor id="highlights" name="highlights" rows={3} maxLength={4000} defaultValue={start?.highlights} />
        </Field>
        <Field name="nextSteps" label={t("fields.nextSteps")}>
          <NoteEditor id="nextSteps" name="nextSteps" rows={3} maxLength={4000} defaultValue={start?.nextSteps} />
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
