"use client";
// What a recruiter or a hiring manager does to one application: move it along, turn it down, or
// record that the candidate pulled out. Three small forms rather than one, because a rejection
// needs a reason and a stage move does not.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { moveApplicationAction, rejectApplicationAction, withdrawApplicationAction } from "../actions";
import { REJECTION_REASONS } from "../enums";

export function ApplicationActions({ applicationId, stages, currentStageId, closed }: { applicationId: string; stages: { id: string; name: string }[]; currentStageId: string; closed: boolean }) {
  const t = useTranslations("recruit.form");
  const actions = useTranslations("recruit.actions");
  const reasons = useTranslations("recruit.rejection");
  const router = useRouter();
  const refresh = () => router.refresh();

  const move = useActionForm(moveApplicationAction, { extra: { applicationId }, onSuccess: refresh });
  const reject = useActionForm(rejectApplicationAction, { extra: { applicationId }, onSuccess: refresh });
  const withdraw = useActionForm(withdrawApplicationAction, { extra: { applicationId }, onSuccess: refresh });

  if (closed) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form onSubmit={move.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
        <FieldErrors value={move.fieldErrors}>
          <Field name="stageId" label={t("stage")}>
            <Select id="stageId" name="stageId" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {stages
                .filter((stage) => stage.id !== currentStageId)
                .map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="move-note" name="note" maxLength={2000} />
          </Field>
        </FieldErrors>
        <FormError namespace="recruit.errors" errorKey={move.errorKey} />
        <Button type="submit" size="sm" disabled={move.pending}>
          {actions("move")}
        </Button>
      </form>

      <form onSubmit={reject.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
        <FieldErrors value={reject.fieldErrors}>
          <Field name="reason" label={t("rejectionReason")}>
            <Select id="reason" name="reason" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {REJECTION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reasons(reason)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="reject-note" name="note" maxLength={2000} />
          </Field>
        </FieldErrors>
        <FormError namespace="recruit.errors" errorKey={reject.errorKey} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="destructive" disabled={reject.pending}>
            {actions("reject")}
          </Button>
        </div>
      </form>

      <form onSubmit={withdraw.onSubmit} className="flex items-end gap-2 sm:col-span-2">
        <FormError namespace="recruit.errors" errorKey={withdraw.errorKey} />
        <Button type="submit" size="sm" variant="outline" disabled={withdraw.pending}>
          {actions("withdraw")}
        </Button>
      </form>
    </div>
  );
}
