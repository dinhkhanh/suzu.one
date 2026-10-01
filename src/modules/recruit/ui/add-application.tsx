"use client";
// Putting somebody already on file into an opening — the CV a colleague forwarded, or a candidate
// from the talent pool being considered again. The public application form (week 2) writes the
// same row through the same service; this is the inside-the-company way in.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { createApplicationAction } from "../actions";
import { CANDIDATE_SOURCES } from "../enums";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";

export function AddApplicationForm({ openingId, candidates, canSetMoney }: { openingId: string; candidates: { id: string; fullName: string }[]; canSetMoney: boolean }) {
  const t = useTranslations("recruit.form");
  const actions = useTranslations("recruit.actions");
  const sources = useTranslations("recruit.source");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createApplicationAction, { extra: { openingId }, onSuccess: () => router.refresh() });

  if (candidates.length === 0) return null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="candidateId" label={t("fullName")}>
            <Select id="candidateId" name="candidateId" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="source" label={t("sourceDetail")}>
            <Select id="source" name="source" defaultValue="direct">
              {CANDIDATE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sources(source)}
                </option>
              ))}
            </Select>
          </Field>
          {canSetMoney ? (
            <Field name="salaryExpectationVnd" label={t("salaryExpectation")}>
              <MoneyInput id="salaryExpectationVnd" name="salaryExpectationVnd" />
            </Field>
          ) : null}
        </div>
        <Field name="coverLetter" label={t("coverLetter")}>
          <NoteEditor id="coverLetter" name="coverLetter" rows={3} maxLength={10_000} />
        </Field>
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={errorKey} />
      <Button type="submit" size="sm" disabled={pending}>
        {actions("addApplication")}
      </Button>
    </form>
  );
}
