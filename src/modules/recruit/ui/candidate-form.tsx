"use client";
// Adding a candidate by hand — the CV a colleague forwarded. The interesting part is the refusal:
// when the server finds somebody who looks like this person it sends the matches back in
// `details`, and the form shows them with *why* each one matched. A bare name match then offers a
// tick box; an email or phone match does not, because that is the same person.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createCandidateAction, updateCandidateAction } from "../actions";
import { CANDIDATE_SOURCES, type CandidateSource } from "../enums";
import type { DuplicateSignal, RedactedDuplicateMatch } from "../engine/duplicates";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export type CandidateFormValue = {
  id: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  location: string | null;
  links: string[];
  source: CandidateSource;
  sourceDetail: string | null;
  referredByPersonId: string | null;
  tags: string[];
  notes: string | null;
};

export function CandidateForm({ value, people }: { value: CandidateFormValue | null; people: { id: string; fullName: string }[] }) {
  const t = useTranslations("recruit.form");
  const tRoot = useTranslations("recruit");
  const sources = useTranslations("recruit.source");
  const duplicates = useTranslations("recruit.duplicates");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors, details } = useActionForm(value?.id ? updateCandidateAction : createCandidateAction, {
    extra: value?.id ? { candidateId: value.id } : {},
    onSuccess: (data) => router.push(`/recruit/candidates/${(data as { id: string }).id}`),
  });

  const matches = (details as { duplicates?: RedactedDuplicateMatch[] } | null)?.duplicates ?? [];
  // Only a bare name match is something a person can overrule.
  const overrulable = matches.length > 0 && matches.every((match) => !match.certain);

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="fullName" label={t("fullName")}>
            <Input id="fullName" name="fullName" required maxLength={200} defaultValue={value?.fullName ?? ""} />
          </Field>
          <Field name="email" label={t("email")}>
            <Input id="email" name="email" type="email" maxLength={200} defaultValue={value?.email ?? ""} />
          </Field>
          <Field name="phone" label={t("phone")}>
            <Input id="phone" name="phone" maxLength={40} defaultValue={value?.phone ?? ""} />
          </Field>
          <Field name="location" label={t("location")}>
            <Input id="location" name="location" maxLength={200} defaultValue={value?.location ?? ""} />
          </Field>
          <Field name="currentTitle" label={t("currentTitle")}>
            <Input id="currentTitle" name="currentTitle" maxLength={200} defaultValue={value?.currentTitle ?? ""} />
          </Field>
          <Field name="currentEmployer" label={t("currentEmployer")}>
            <Input id="currentEmployer" name="currentEmployer" maxLength={200} defaultValue={value?.currentEmployer ?? ""} />
          </Field>
          <Field name="source" label={tRoot("columns.source")}>
            <Select id="source" name="source" defaultValue={value?.source ?? "direct"}>
              {CANDIDATE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sources(source)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="sourceDetail" label={t("sourceDetail")}>
            <Input id="sourceDetail" name="sourceDetail" maxLength={200} defaultValue={value?.sourceDetail ?? ""} />
          </Field>
          <Field name="referredByPersonId" label={t("referredBy")}>
            <Select id="referredByPersonId" name="referredByPersonId" defaultValue={value?.referredByPersonId ?? ""}>
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field name="links" label={t("links")}>
          <textarea id="links" name="links" rows={3} className={textarea} defaultValue={(value?.links ?? []).join("\n")} />
        </Field>
        <Field name="tags" label={t("tags")}>
          <textarea id="tags" name="tags" rows={2} className={textarea} defaultValue={(value?.tags ?? []).join("\n")} />
        </Field>
        <Field name="notes" label={t("notes")}>
          <textarea id="notes" name="notes" rows={4} maxLength={5000} className={textarea} defaultValue={value?.notes ?? ""} />
        </Field>
      </FieldErrors>

      {matches.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20">
          <p className="font-medium">{duplicates("title")}</p>
          <ul className="flex flex-col gap-1">
            {matches.map((match, index) => (
              <li key={match.id ?? `elsewhere-${index}`} className="flex flex-wrap items-center gap-2">
                {/* A match outside the recruiter's reach arrives without an id or a name. */}
                {match.id ? (
                  <a href={`/recruit/candidates/${match.id}`} className="underline underline-offset-4">
                    {match.fullName}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{duplicates("elsewhere")}</span>
                )}
                <span className="text-xs text-muted-foreground">{match.signals.map((signal: DuplicateSignal) => duplicates(`signal.${signal}`)).join(", ")}</span>
              </li>
            ))}
          </ul>
          {overrulable && !value?.id ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirmedNotDuplicate" className="size-4" />
              {t("confirmedNotDuplicate")}
            </label>
          ) : null}
        </div>
      ) : null}

      <FormError namespace="recruit.errors" errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {tRoot("save")}
        </Button>
      </div>
    </form>
  );
}
