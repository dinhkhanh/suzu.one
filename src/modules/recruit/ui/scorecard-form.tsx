"use client";
// The interviewer's own card, and the panel's.
//
// The blind rule is enforced in `interviews.ts` — this component is only ever handed what the
// service decided it may see, and `blind` is the service telling it *why* the panel is empty. A
// blank section with no explanation reads like a bug and gets reported as one; saying "the others'
// feedback appears once yours is in" is both true and the nudge that makes the rule work.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INTERVIEW_RECOMMENDATIONS, SCORE_MAX, SCORE_MIN, type InterviewRecommendation, type ScorecardCriterion } from "../enums";
import { saveScorecardAction } from "../interview-actions";

export type MyCard = { ratings: Record<string, number>; recommendation: InterviewRecommendation | null; strengths: string | null; concerns: string | null; notes: string | null; submitted: boolean };

export type OtherCard = {
  interviewerPersonId: string;
  interviewerName: string;
  ratings: Record<string, number>;
  recommendation: InterviewRecommendation | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
};

const SCORES = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, index) => SCORE_MIN + index);

function Ratings({ criteria, ratings }: { criteria: ScorecardCriterion[]; ratings: Record<string, number> }) {
  const t = useTranslations("recruit.scorecard");
  return (
    <div className="flex flex-col gap-3">
      {criteria.map((criterion) => (
        <div key={criterion.key} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Label htmlFor={`rating-${criterion.key}`}>{criterion.label}</Label>
            {criterion.hint ? <p className="text-xs text-muted-foreground">{criterion.hint}</p> : null}
          </div>
          <Select id={`rating-${criterion.key}`} name={`ratings.${criterion.key}`} defaultValue={ratings[criterion.key] ? String(ratings[criterion.key]) : ""} className="w-40">
            <option value="">—</option>
            {SCORES.map((score) => (
              <option key={score} value={score}>
                {t(`scale.${score}` as "scale.1")}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

export function ScorecardForm({ interviewId, criteria, mine, canScore }: { interviewId: string; criteria: ScorecardCriterion[]; mine: MyCard | null; canScore: boolean }) {
  const t = useTranslations("recruit.scorecard");
  const router = useRouter();
  const form = useActionForm(saveScorecardAction, { extra: { interviewId }, onSuccess: () => router.refresh() });

  if (!canScore) return null;

  if (mine?.submitted) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("mine")}</h3>
          <Badge variant="outline">{t("submitted")}</Badge>
        </div>
        <CardBody criteria={criteria} card={mine} />
        <p className="text-xs text-muted-foreground">{t("finalNote")}</p>
      </section>
    );
  }

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-medium">{t("mine")}</h3>
        <p className="text-xs text-muted-foreground">{t("blindHint")}</p>
      </div>
      <FieldErrors value={form.fieldErrors}>
        <Ratings criteria={criteria} ratings={mine?.ratings ?? {}} />
        <Field name="recommendation" label={t("recommendation")}>
          <Select id="recommendation" name="recommendation" defaultValue={mine?.recommendation ?? ""}>
            <option value="">—</option>
            {INTERVIEW_RECOMMENDATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`recommendations.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="strengths" label={t("strengths")}>
          <textarea id="strengths" name="strengths" rows={3} maxLength={4000} defaultValue={mine?.strengths ?? ""} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
        </Field>
        <Field name="concerns" label={t("concerns")}>
          <textarea id="concerns" name="concerns" rows={3} maxLength={4000} defaultValue={mine?.concerns ?? ""} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
        </Field>
        <Field name="notes" label={t("notes")}>
          <textarea id="notes" name="notes" rows={3} maxLength={4000} defaultValue={mine?.notes ?? ""} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
        </Field>
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap items-center gap-2">
        {/* The clicked button is part of the form data, so one form offers both outcomes. */}
        <Button type="submit" size="sm" variant="outline" disabled={form.pending}>
          {t("saveDraft")}
        </Button>
        <Button type="submit" size="sm" name="submit" value="on" disabled={form.pending}>
          {t("submit")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("submitWarning")}</span>
      </div>
      {form.saved ? <p className="text-xs text-muted-foreground">{t("saved")}</p> : null}
    </form>
  );
}

function CardBody({ criteria, card }: { criteria: ScorecardCriterion[]; card: { ratings: Record<string, number>; recommendation: InterviewRecommendation | null; strengths: string | null; concerns: string | null; notes: string | null } }) {
  const t = useTranslations("recruit.scorecard");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid gap-1 sm:grid-cols-2">
        {criteria.map((criterion) => (
          <div key={criterion.key} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{criterion.label}</dt>
            <dd>{card.ratings[criterion.key] ? t(`scale.${card.ratings[criterion.key]}` as "scale.1") : "—"}</dd>
          </div>
        ))}
      </dl>
      {card.recommendation ? (
        <p>
          <span className="text-muted-foreground">{t("recommendation")}: </span>
          {t(`recommendations.${card.recommendation}`)}
        </p>
      ) : null}
      {card.strengths ? <p className="whitespace-pre-line">{card.strengths}</p> : null}
      {card.concerns ? <p className="whitespace-pre-line text-muted-foreground">{card.concerns}</p> : null}
      {card.notes ? <p className="whitespace-pre-line text-muted-foreground">{card.notes}</p> : null}
    </div>
  );
}

export function ScorecardPanel({ criteria, others, blind, awaiting }: { criteria: ScorecardCriterion[]; others: OtherCard[]; blind: boolean; awaiting: number }) {
  const t = useTranslations("recruit.scorecard");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("panel")}</h3>
        {awaiting > 0 ? <span className="text-xs text-muted-foreground">{t("awaiting", { count: awaiting })}</span> : null}
      </div>
      {/* The service returned nothing because this reader has not submitted theirs. Say so. */}
      {blind ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("blind")}</p> : null}
      {!blind && others.length === 0 ? <p className="text-sm text-muted-foreground">{t("noneYet")}</p> : null}
      {others.map((card) => (
        <article key={card.interviewerPersonId} className="flex flex-col gap-2 rounded-xl border p-4">
          <h4 className="text-sm font-medium">{card.interviewerName}</h4>
          <CardBody criteria={criteria} card={card} />
        </article>
      ))}
    </section>
  );
}
