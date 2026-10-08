"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { CONTRACT_EVENT_TYPES, CONTRACT_TYPES, HAND_RECORDED_EVENT_TYPES, JOB_CATEGORIES, TERMINATION_REASONS, WORKFORCE_TYPES } from "../enums";
import {
  cancelLifecycleEventAction,
  liftSuspensionAction,
  recordContractEventAction,
  recordLifecycleEventAction,
  rehirePersonAction,
  submitResignationAction,
  suspendPersonAction,
  terminateEmploymentAction,
  transferToEntityAction,
} from "../lifecycle-actions";
import { TableAddRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/ui/confirm";
import { PlacementFields, type PlacementOptions } from "./fields";

/** Events HR writes down: probation result, renewal, reward, discipline, long leave, salary change (no amounts). */
export function RecordEventForm({ personId, today }: { personId: string; today: string }) {
  const t = useTranslations("lifecycle");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(recordLifecycleEventAction, {
    extra: { personId },
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });
  return (
    <TableAddRow label={t("record.title")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="type" label={t("fields.type")}>
            <Select id="type" name="type" required defaultValue="probation_fail">
              {HAND_RECORDED_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="effectiveDate" label={t("fields.effectiveDate")}>
            <DatePicker id="effectiveDate" name="effectiveDate" required defaultValue={today} />
          </Field>
          <Field name="reason" label={t("fields.reason")}>
            <Input id="reason" name="reason" maxLength={300} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="note" label={t("fields.note")}>
              <Input id="note" name="note" maxLength={2000} placeholder={t("record.noteHint")} />
            </Field>
          </div>
        </div>
        <FormError namespace="lifecycle.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {t("record.submit")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}

/**
 * A probation passed or a contract renewed (FR-CHR-09): the new contract, the workforce type from
 * that day and — when a template is chosen — the decision paper, in one step. `templates` are the
 * ones this viewer may issue for this person; `canWritePay` shows the pay-terms field.
 */
export function ContractEventForm({
  personId,
  today,
  templates,
  canWritePay,
  onProbation,
}: {
  personId: string;
  today: string;
  templates: { id: string; name: string }[];
  canWritePay: boolean;
  /** On probation now: the form opens on "passed probation". */ onProbation: boolean;
}) {
  const t = useTranslations("lifecycle");
  const tr = useTranslations("records");
  const tp = useTranslations("people");
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<(typeof CONTRACT_EVENT_TYPES)[number]>(onProbation ? "probation_pass" : "contract_renewal");
  const [contractType, setContractType] = useState<(typeof CONTRACT_TYPES)[number]>("fixed_term");
  const [made, setMade] = useState<{ id: string; number: string } | null>(null);
  const { onSubmit, pending, errorKey } = useActionForm<{ document: { id: string; number: string } | null }>(recordContractEventAction, {
    extra: { personId, type, contractType },
    onSuccess: (data) => {
      setMade(data.document);
      form.current?.reset();
      router.refresh();
    },
  });
  return (
    <TableAddRow label={t("contractEvent.title")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("contractEvent.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="type" label={t("fields.type")}>
            <Select id="contract-event-type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              {CONTRACT_EVENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`types.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="effectiveDate" label={t("contractEvent.effectiveDate")}>
            <DatePicker id="contract-event-date" name="effectiveDate" required defaultValue={today} />
          </Field>
          {type === "probation_pass" ? (
            <Field name="workforceType" label={t("contractEvent.workforceType")}>
              <Select id="contract-event-workforce" name="workforceType" defaultValue="employee">
                {WORKFORCE_TYPES.filter((value) => value !== "probation").map((value) => (
                  <option key={value} value={value}>
                    {tp(`workforceType.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field name="contractType" label={tr("contracts.type")}>
            <Select id="contract-event-contract-type" value={contractType} onChange={(event) => setContractType(event.target.value as typeof contractType)}>
              {CONTRACT_TYPES.filter((value) => value !== "appendix" && value !== "nda" && (type === "contract_renewal" || value !== "probation")).map((value) => (
                <option key={value} value={value}>
                  {tr(`contracts.types.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="contractNumber" label={tr("contracts.number")}>
            <Input id="contract-event-number" name="contractNumber" required maxLength={60} />
          </Field>
          <Field name="signDate" label={tr("contracts.signDate")}>
            <DatePicker id="contract-event-sign" name="signDate" />
          </Field>
          {contractType === "indefinite" ? null : (
            <Field name="endDate" label={tr("contracts.endDate")}>
              <DatePicker id="contract-event-end" name="endDate" required={contractType === "fixed_term" || contractType === "probation"} />
            </Field>
          )}
          {contractType === "probation" ? (
            <Field name="jobCategory" label={tr("contracts.jobCategory")}>
              <Select id="contract-event-category" name="jobCategory" required defaultValue="professional">
                {JOB_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {tr(`contracts.jobCategories.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {templates.length > 0 ? (
            <Field name="templateId" label={t("contractEvent.template")}>
              <Select id="contract-event-template" name="templateId" defaultValue="">
                <option value="">{t("contractEvent.noPaper")}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field name="reason" label={t("fields.reason")}>
            <Input id="contract-event-reason" name="reason" maxLength={300} />
          </Field>
          {canWritePay ? (
            <Field name="salaryTerms" label={tr("contracts.salaryTerms")}>
              <Input id="contract-event-terms" name="salaryTerms" maxLength={2000} placeholder={tr("contracts.salaryTermsHint")} autoComplete="off" />
            </Field>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="note" label={t("fields.note")}>
              <Input id="contract-event-note" name="note" maxLength={2000} />
            </Field>
          </div>
        </div>
        <FormError namespace="records.errors" errorKey={errorKey} />
        {made ? (
          <p className="text-sm">
            {t("contractEvent.made", { number: made.number })}{" "}
            <a href={`/documents/${made.id}/pdf`} className="underline">
              {t("contractEvent.download")}
            </a>
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={pending}>
            {t("contractEvent.submit")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}

export function TerminateForm({ personId, today, resignation }: { personId: string; today: string; /** An approved resignation waiting to be carried out. */ resignation?: { eventId: string; lastDay: string } }) {
  const t = useTranslations("lifecycle");
  const form = useRef<HTMLFormElement>(null);
  // Where a flow was saved for terminations, this proposes one and it waits for its approval (FR-CHR-09).
  const [proposed, setProposed] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm<{ pendingApproval: boolean }>(terminateEmploymentAction, {
    extra: { personId, resignationEventId: resignation?.eventId ?? "" },
    onSuccess: (data) => setProposed(data.pendingApproval),
  });
  return (
    <details className="rounded-xl border p-4" open={!!resignation}>
      <summary className="cursor-pointer text-sm font-medium">{resignation ? t("terminate.fromResignation") : t("terminate.title")}</summary>
      <form ref={form} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("terminate.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="lastDay" label={t("fields.lastDay")}>
            <DatePicker id="lastDay" name="lastDay" required defaultValue={resignation?.lastDay ?? today} />
          </Field>
          <Field name="reason" label={t("fields.terminationReason")}>
            <Select id="reason" name="reason" required defaultValue={resignation ? "resignation" : "contract_end"}>
              {TERMINATION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`reasons.${reason}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="note" label={t("fields.note")}>
            <Input id="note" name="note" maxLength={2000} />
          </Field>
        </div>
        <FormError namespace="lifecycle.errors" errorKey={errorKey} />
        {proposed ? <Alert variant="info">{t("terminate.proposed")}</Alert> : null}
        <div>
          <ConfirmButton
            variant="destructive"
            destructive
            disabled={pending}
            label={t("terminate.submit")}
            question={t("terminate.confirm")}
            beforeOpen={() => !!form.current?.reportValidity()}
            onConfirm={() => form.current?.requestSubmit()}
          />
        </div>
      </form>
    </details>
  );
}

/**
 * Suspend the account, or lift the suspension (FR-PLT-05). No confirm box: suspending asks for the
 * reason, and typing it is the second thought.
 */
export function SuspensionForm({ personId, suspended }: { personId: string; suspended: boolean }) {
  const t = useTranslations("lifecycle");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm<{ id: string }>(suspended ? liftSuspensionAction : suspendPersonAction, { extra: { personId }, onSuccess: () => router.refresh() });
  return (
    <details className="rounded-xl border p-4" open={suspended}>
      <summary className="cursor-pointer text-sm font-medium">{suspended ? t("suspend.liftTitle") : t("suspend.title")}</summary>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{suspended ? t("suspend.liftHint") : t("suspend.hint")}</p>
        <Field name="reason" label={suspended ? t("suspend.liftReason") : t("suspend.reason")}>
          <Input id="suspend-reason" name="reason" maxLength={1000} required={!suspended} />
        </Field>
        <FormError namespace="lifecycle.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" variant={suspended ? "default" : "destructive"} disabled={pending}>
            {suspended ? t("suspend.liftSubmit") : t("suspend.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function CancelEventButton({ eventId, label }: { eventId: string; label: string }) {
  const t = useTranslations("lifecycle");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(cancelLifecycleEventAction, { extra: { eventId } });
  return (
    <form ref={form} onSubmit={onSubmit} className="flex items-center gap-2">
      <ConfirmButton size="xs" variant="ghost" disabled={pending} label={label} question={t("cancelConfirm")} onConfirm={() => form.current?.requestSubmit()} />
      <FormError namespace="lifecycle.errors" errorKey={errorKey} />
    </form>
  );
}

export function RehireForm({ personId, entities, options, today, defaultEntityId }: { personId: string; entities: { id: string; name: string }[]; options: PlacementOptions; today: string; defaultEntityId: string | null }) {
  const t = useTranslations("lifecycle");
  const tp = useTranslations("people");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities.find((entity) => entity.id === defaultEntityId)?.id ?? entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey } = useActionForm(rehirePersonAction, { extra: { personId }, onSuccess: () => router.refresh() });
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("rehire.title")}</summary>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("rehire.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="entityId" label={tp("fields.entity")}>
            <Select id="entityId" name="entityId" required value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="employeeCode" label={tp("fields.employeeCode")}>
            <Input id="employeeCode" name="employeeCode" maxLength={30} placeholder={tp("fields.employeeCodeHint")} />
          </Field>
          <div className="hidden lg:block" />
          <Field name="startDate" label={tp("fields.startDate")}>
            <DatePicker id="startDate" name="startDate" required defaultValue={today} />
          </Field>
          <Field name="seniorityDate" label={tp("fields.seniorityDate")}>
            <DatePicker id="seniorityDate" name="seniorityDate" />
          </Field>
        </div>
        <PlacementFields options={{ ...options, branches: options.branches.filter((branch) => branch.entityId === entityId) }} exceptPersonId={personId} />
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {t("rehire.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}

/**
 * Moves an employee to another entity of the group (FR-PLT-15): the employment with today's entity
 * ends the day before, a new one opens with the chosen entity, seniority carries over.
 */
export function TransferEntityForm({
  personId,
  entities,
  options,
  today,
  minDate,
  defaults,
}: {
  personId: string;
  entities: { id: string; name: string }[];
  options: PlacementOptions;
  today: string;
  /** The day after the current employment started. */ minDate: string;
  defaults: Parameters<typeof PlacementFields>[0]["defaults"];
}) {
  const t = useTranslations("lifecycle");
  const tp = useTranslations("people");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(transferToEntityAction, { extra: { personId }, onSuccess: () => router.refresh() });
  // A unit or branch of another entity is not a place in this one; shared units always are.
  const placement = { ...options, units: options.units.filter((unit) => !unit.entityId || unit.entityId === entityId), branches: options.branches.filter((branch) => branch.entityId === entityId) };
  return (
    <TableAddRow label={t("transfer.title")}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("transfer.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="entityId" label={t("transfer.entity")}>
            <Select id="entityId" name="entityId" required value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="startDate" label={t("transfer.startDate")}>
            <DatePicker id="startDate" name="startDate" required defaultValue={today} min={minDate} max={today} />
          </Field>
          <Field name="employeeCode" label={tp("fields.employeeCode")}>
            <Input id="employeeCode" name="employeeCode" maxLength={30} placeholder={tp("fields.employeeCodeHint")} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="reason" label={tp("fields.changeReason")}>
              <Input id="reason" name="reason" maxLength={300} />
            </Field>
          </div>
        </div>
        {/* Keyed so the unit and branch pickers start over when the entity changes. */}
        <PlacementFields key={entityId} options={placement} defaults={defaults} exceptPersonId={personId} />
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <ConfirmButton disabled={pending || !entityId} label={t("transfer.submit")} question={t("transfer.confirm")} beforeOpen={() => !!form.current?.reportValidity()} onConfirm={() => form.current?.requestSubmit()} />
        </div>
      </form>
    </TableAddRow>
  );
}

/** On "My profile": the employee's own resignation request. */
export function ResignationForm({ today }: { today: string }) {
  const t = useTranslations("lifecycle");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(submitResignationAction, { onSuccess: (data) => router.push(`/approvals/resignation/${data.id}`) });
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("resign.title")}</summary>
      <form ref={form} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("resign.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="lastWorkingDay" label={t("fields.lastDay")}>
            <DatePicker id="lastWorkingDay" name="lastWorkingDay" required min={today} />
          </Field>
          <Field name="reason" label={t("fields.reason")}>
            <Input id="reason" name="reason" maxLength={1000} />
          </Field>
        </div>
        <FormError namespace="lifecycle.errors" errorKey={errorKey} />
        <div>
          <ConfirmButton variant="outline" disabled={pending} label={t("resign.submit")} question={t("resign.confirm")} beforeOpen={() => !!form.current?.reportValidity()} onConfirm={() => form.current?.requestSubmit()} />
        </div>
      </form>
    </details>
  );
}
