"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RECORD_ONLY_EVENT_TYPES, TERMINATION_REASONS } from "../enums";
import { cancelLifecycleEventAction, recordLifecycleEventAction, rehirePersonAction, submitResignationAction, terminateEmploymentAction, transferToEntityAction } from "../lifecycle-actions";
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
    <details ref={details} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("record.title")}</summary>
      <form ref={form} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="type" label={t("fields.type")}>
            <Select id="type" name="type" required defaultValue="probation_pass">
              {RECORD_ONLY_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="effectiveDate" label={t("fields.effectiveDate")}>
            <Input id="effectiveDate" name="effectiveDate" type="date" required defaultValue={today} />
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
    </details>
  );
}

export function TerminateForm({ personId, today, resignation }: { personId: string; today: string; /** An approved resignation waiting to be carried out. */ resignation?: { eventId: string; lastDay: string } }) {
  const t = useTranslations("lifecycle");
  const { onSubmit, pending, errorKey } = useActionForm(terminateEmploymentAction, { extra: { personId, resignationEventId: resignation?.eventId ?? "" } });
  return (
    <details className="rounded-xl border p-4" open={!!resignation}>
      <summary className="cursor-pointer text-sm font-medium">{resignation ? t("terminate.fromResignation") : t("terminate.title")}</summary>
      <form
        onSubmit={(event) => {
          if (window.confirm(t("terminate.confirm"))) onSubmit(event);
          else event.preventDefault();
        }}
        className="mt-4 flex flex-col gap-4"
      >
        <p className="text-sm text-muted-foreground">{t("terminate.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="lastDay" label={t("fields.lastDay")}>
            <Input id="lastDay" name="lastDay" type="date" required defaultValue={resignation?.lastDay ?? today} />
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
        <div>
          <Button type="submit" variant="destructive" disabled={pending}>
            {t("terminate.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function CancelEventButton({ eventId, label }: { eventId: string; label: string }) {
  const t = useTranslations("lifecycle");
  const { onSubmit, pending, errorKey } = useActionForm(cancelLifecycleEventAction, { extra: { eventId } });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(t("cancelConfirm"))) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <Button type="submit" size="xs" variant="ghost" disabled={pending}>
        {label}
      </Button>
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
            <Input id="startDate" name="startDate" type="date" required defaultValue={today} />
          </Field>
          <Field name="seniorityDate" label={tp("fields.seniorityDate")}>
            <Input id="seniorityDate" name="seniorityDate" type="date" />
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
export function TransferEntityForm({ personId, entities, options, today, minDate, defaults }: { personId: string; entities: { id: string; name: string }[]; options: PlacementOptions; today: string; /** The day after the current employment started. */ minDate: string; defaults: Parameters<typeof PlacementFields>[0]["defaults"] }) {
  const t = useTranslations("lifecycle");
  const tp = useTranslations("people");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey } = useActionForm(transferToEntityAction, { extra: { personId }, onSuccess: () => router.refresh() });
  // A unit or branch of another entity is not a place in this one; shared units always are.
  const placement = { ...options, units: options.units.filter((unit) => !unit.entityId || unit.entityId === entityId), branches: options.branches.filter((branch) => branch.entityId === entityId) };
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("transfer.title")}</summary>
      <form
        onSubmit={(event) => {
          if (window.confirm(t("transfer.confirm"))) onSubmit(event);
          else event.preventDefault();
        }}
        className="mt-4 flex flex-col gap-4"
      >
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
            <Input id="startDate" name="startDate" type="date" required defaultValue={today} min={minDate} max={today} />
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
          <Button type="submit" disabled={pending || !entityId}>
            {t("transfer.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}

/** On "My profile": the employee's own resignation request. */
export function ResignationForm({ today }: { today: string }) {
  const t = useTranslations("lifecycle");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(submitResignationAction, { onSuccess: (data) => router.push(`/approvals/resignation/${data.id}`) });
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("resign.title")}</summary>
      <form
        onSubmit={(event) => {
          if (window.confirm(t("resign.confirm"))) onSubmit(event);
          else event.preventDefault();
        }}
        className="mt-4 flex flex-col gap-4"
      >
        <p className="text-sm text-muted-foreground">{t("resign.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="lastWorkingDay" label={t("fields.lastDay")}>
            <Input id="lastWorkingDay" name="lastWorkingDay" type="date" required min={today} />
          </Field>
          <Field name="reason" label={t("fields.reason")}>
            <Input id="reason" name="reason" maxLength={1000} />
          </Field>
        </div>
        <FormError namespace="lifecycle.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {t("resign.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}
