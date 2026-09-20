// Display pieces of the review screens. No hooks: labels and the number format come in as props,
// so the same pieces work in server and client components.
import type { ReviewFormKind, ReviewStage, ReviewFormShape, RatingPoint } from "../enums";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type NumberFormat = { number(value: number, options?: { maximumFractionDigits?: number }): string };

const pill = "inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap";

/** How far one person's review has got. The colour follows the order of the stages, not the mood. */
export function StageBadge({ stage, label }: { stage: ReviewStage; label: string }) {
  const tone =
    stage === "acknowledged" || stage === "released"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : stage === "pending"
        ? "border border-dashed text-muted-foreground"
        : "bg-muted text-foreground";
  return <span className={`${pill} ${tone}`}>{label}</span>;
}

export function FormStatusBadge({ status, label }: { status: "draft" | "submitted" | null; label: string }) {
  const tone = status === "submitted" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : status === "draft" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border border-dashed text-muted-foreground";
  return <span className={`${pill} ${tone}`}>{label}</span>;
}

export const ratingText = (format: NumberFormat, bp: number | null): string => (bp === null ? "—" : `${format.number(bp / 100, { maximumFractionDigits: 1 })} %`);

/** The scale point a figure lands on, for reading a stored rating back as words. */
export const pointOfBp = (scale: readonly RatingPoint[], bp: number | null): RatingPoint | null => (bp === null ? null : (scale.find((point) => point.scoreBp === bp) ?? null));

/**
 * One submitted form, read-only: every question asked of that form, what was answered, and the
 * figure it came to. The page decides whether the viewer may see it at all; this only draws it.
 */
export function FilledForm({ shape, kind, answers, overallRatingBp, comment, author, labels }: { shape: ReviewFormShape; kind: ReviewFormKind; answers: Record<string, string | number>; overallRatingBp: number | null; comment: string | null; author: string | null; labels: { t: Translate; format: NumberFormat } }) {
  const { t, format } = labels;
  const asked = shape.sections.filter((section) => section.askedOf.includes(kind));
  return (
    <article className="flex flex-col gap-3 rounded-xl border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{author ? t(`form.by.${kind}`, { name: author }) : t(`form.kind.${kind}`)}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{t("form.overall", { value: ratingText(format, overallRatingBp) })}</span>
      </header>
      <dl className="flex flex-col gap-3">
        {asked.map((section) => {
          const answer = answers[section.key];
          const point = section.kind === "rating" ? shape.ratingScale.find((item) => item.value === Number(answer)) : null;
          return (
            <div key={section.key} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{section.title}</dt>
              <dd className="text-sm whitespace-pre-wrap">{section.kind === "rating" ? (point ? `${point.label} (${ratingText(format, point.scoreBp)})` : "—") : typeof answer === "string" && answer.trim() !== "" ? answer : "—"}</dd>
            </div>
          );
        })}
      </dl>
      {comment ? (
        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground">{t("form.comment")}</p>
          <p className="text-sm whitespace-pre-wrap">{comment}</p>
        </div>
      ) : null}
    </article>
  );
}

/** The timeline of a cycle as a line of dates — what is due when. */
export function Timeline({ dates, labels }: { dates: { key: string; on: string | null }[]; labels: { t: Translate; formatDate: (value: string) => string } }) {
  const shown = dates.filter((date) => date.on !== null);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {shown.map((date) => (
        <li key={date.key}>
          <span className="font-medium">{labels.t(`timeline.${date.key}`)}</span> {labels.formatDate(date.on!)}
        </li>
      ))}
    </ul>
  );
}
