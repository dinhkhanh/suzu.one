// What makes a review form template usable (FR-PRF-03). Pure: the screen's save, the launch of a
// cycle and the seed's starter templates all ask the same question here, so a template that
// passes one passes them all.
import { type RatingPoint, type ReviewCycleKind, REVIEW_CYCLE_KINDS, REVIEW_FORM_KINDS, REVIEW_SECTION_KINDS, type ReviewSection, SECTION_KEY } from "../enums";

export type TemplateDraft = { name: string; sections: readonly ReviewSection[]; ratingScale: readonly RatingPoint[]; kinds?: readonly ReviewCycleKind[] };

export type TemplateProblem =
  | "review_template_name_empty"
  | "review_template_empty"
  | "review_template_bad_key"
  | "review_template_duplicate_key"
  | "review_template_untitled_section"
  | "review_template_unasked_section"
  | "review_template_bad_section"
  | "review_template_scale_short"
  | "review_template_duplicate_point"
  | "review_template_bad_point"
  | "review_template_unscored"
  | "review_template_manager_unscored"
  | "review_template_bad_kind";

/**
 * Everything wrong with a template, in the order a person would fix it. Empty = usable.
 *
 * Two rules are about the money rather than the form: a template with no weighted rating section
 * scores nothing, and the **manager's** form in particular must carry one — its figure is the
 * rating the final yearly result reads (FR-PRF-09), so a manager form of prose alone would
 * release a review worth nothing.
 */
export function templateProblems(draft: TemplateDraft): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const { sections, ratingScale } = draft;
  if (draft.name.trim() === "") problems.push("review_template_name_empty");
  if (sections.length === 0) problems.push("review_template_empty");
  if (sections.some((section) => !SECTION_KEY.test(section.key))) problems.push("review_template_bad_key");
  if (new Set(sections.map((section) => section.key)).size !== sections.length) problems.push("review_template_duplicate_key");
  if (sections.some((section) => section.title.trim() === "")) problems.push("review_template_untitled_section");
  if (sections.some((section) => section.askedOf.length === 0)) problems.push("review_template_unasked_section");
  if (sections.some((section) => !REVIEW_SECTION_KINDS.includes(section.kind) || !Number.isInteger(section.weight) || section.weight < 0 || section.askedOf.some((kind) => !REVIEW_FORM_KINDS.includes(kind))))
    problems.push("review_template_bad_section");
  if (ratingScale.length < 2) problems.push("review_template_scale_short");
  if (new Set(ratingScale.map((point) => point.value)).size !== ratingScale.length) problems.push("review_template_duplicate_point");
  if (ratingScale.some((point) => point.label.trim() === "" || !Number.isInteger(point.value) || !Number.isInteger(point.scoreBp) || point.scoreBp < 0)) problems.push("review_template_bad_point");
  const scored = sections.filter((section) => section.kind === "rating" && section.weight > 0);
  if (sections.length > 0 && scored.length === 0) problems.push("review_template_unscored");
  else if (scored.length > 0 && !scored.some((section) => section.askedOf.includes("manager"))) problems.push("review_template_manager_unscored");
  if ((draft.kinds ?? []).some((kind) => !REVIEW_CYCLE_KINDS.includes(kind))) problems.push("review_template_bad_kind");
  return problems;
}
