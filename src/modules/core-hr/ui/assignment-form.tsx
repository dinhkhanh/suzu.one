"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { ASSIGNMENT_CHANGE_KINDS } from "../enums";
import { changeAssignmentAction, recordPastAssignmentAction } from "../actions";
import type { PersonView } from "../service";
import { Field, FormError } from "@/components/forms/field";
import { PlacementFields, type PlacementOptions } from "./fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { TableAddRow } from "@/components/ui/table";

export function AssignmentForm({ person, options, today }: { person: PersonView; options: PlacementOptions; today: string }) {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // Where a flow was saved for transfers or promotions, the change waits for its approval (FR-CHR-09).
  const [proposed, setProposed] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm<{ pendingApproval: boolean }>(changeAssignmentAction, {
    extra: { personId: person.id },
    onSuccess: (data) => {
      setProposed(data.pendingApproval);
      if (data.pendingApproval) return;
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });
  const current = person.personal?.current;

  return (
    <TableAddRow label={t("assignment.change")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("assignment.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="validFrom" label={t("fields.validFrom")}>
            <DatePicker id="validFrom" name="validFrom" required defaultValue={today} min={person.personal?.startDate ?? undefined} />
          </Field>
          <Field name="kind" label={t("assignment.kind")}>
            <Select id="kind" name="kind" defaultValue="transfer">
              {ASSIGNMENT_CHANGE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`assignment.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="changeReason" label={t("fields.changeReason")}>
              <Input id="changeReason" name="changeReason" maxLength={300} />
            </Field>
          </div>
        </div>
        {/* Keyed so the defaults follow the assignment once it changes. */}
        <PlacementFields key={current?.id} options={options} defaults={current ?? undefined} exceptPersonId={person.id} />
        <FormError namespace="people.errors" errorKey={errorKey} />
        {proposed ? <Alert variant="info">{t("assignment.proposed")}</Alert> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}

/** A period of work history that is already over — for writing down, at roll-out, where someone sat before. */
export function PastAssignmentForm({ person, options, today }: { person: PersonView; options: PlacementOptions; today: string }) {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(recordPastAssignmentAction, {
    extra: { personId: person.id },
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });

  return (
    <TableAddRow label={t("assignment.past.title")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("assignment.past.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="validFrom" label={t("assignment.past.from")}>
            <DatePicker id="past.validFrom" name="validFrom" required max={today} />
          </Field>
          <Field name="validTo" label={t("assignment.past.to")}>
            <DatePicker id="past.validTo" name="validTo" required max={today} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="changeReason" label={t("fields.changeReason")}>
              <Input id="past.changeReason" name="changeReason" maxLength={300} />
            </Field>
          </div>
        </div>
        <PlacementFields options={options} exceptPersonId={person.id} />
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}
