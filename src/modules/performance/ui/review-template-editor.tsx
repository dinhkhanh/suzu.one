"use client";
// The review form designer (FR-PRF-03, PRF-01): a template's name and the cycle kinds it is for,
// its questions — who is asked each one, whether it is scored and for how much — and the rating
// scale with what each point is worth. Everything is checked as HR types by the very engine the
// server and the seed use (`engine/review-template.ts`), so "save" is refused for the same reasons
// in all three places and HR sees why before a round trip.
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { templateProblems } from "../engine/review-template";
import { REVIEW_CYCLE_KINDS, REVIEW_FORM_KINDS, REVIEW_SECTION_KINDS, type RatingPoint, type ReviewCycleKind, type ReviewFormKind, type ReviewSection, type ReviewSectionKind } from "../enums";
import { saveReviewTemplateAction } from "../review-actions";

const ERRORS = "performance.reviews.errors";

export type TemplateDraft = { id: string | null; name: string; nameEn: string | null; description: string | null; kinds: ReviewCycleKind[]; sections: ReviewSection[]; ratingScale: RatingPoint[]; isActive: boolean };

// What the fields hold while HR types: numbers as text, so a half-typed "1," is not lost.
type SectionDraft = Omit<ReviewSection, "weight"> & { weight: string };
type PointDraft = { value: string; label: string; labelEn: string; scorePercent: string };

const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text.replace(",", ".")));

/** The next free key `q1`, `q2`… — a key is only the name an answer is stored under. */
const freeKey = (sections: readonly SectionDraft[]): string => {
  const taken = new Set(sections.map((section) => section.key));
  let index = sections.length + 1;
  while (taken.has(`q${index}`)) index += 1;
  return `q${index}`;
};

const percentText = (bp: number): string => String(bp / 100);

export function ReviewTemplateEditor({ draft, editable }: { draft: TemplateDraft; editable: boolean }) {
  const t = useTranslations("performance.reviews.templates");
  const tCycle = useTranslations("performance.reviews.cycle");
  const tForm = useTranslations("performance.reviews.form");
  const tErrors = useTranslations(ERRORS);
  const router = useRouter();
  const [basics, setBasics] = useState({ name: draft.name, nameEn: draft.nameEn ?? "", description: draft.description ?? "", kinds: draft.kinds, isActive: draft.isActive });
  const [sections, setSections] = useState<SectionDraft[]>(() => draft.sections.map((section) => ({ ...section, weight: String(section.weight) })));
  const [scale, setScale] = useState<PointDraft[]>(() => draft.ratingScale.map((point) => ({ value: String(point.value), label: point.label, labelEn: point.labelEn ?? "", scorePercent: percentText(point.scoreBp) })));
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // The shape the engine and the action read.
  const shapedSections: ReviewSection[] = sections.map((section) => ({ ...section, titleEn: section.titleEn?.trim() ? section.titleEn : null, weight: section.kind === "rating" ? toNumber(section.weight) : 0 }));
  const shapedScale: RatingPoint[] = scale.map((point) => ({ value: toNumber(point.value), label: point.label, labelEn: point.labelEn.trim() ? point.labelEn : null, scoreBp: Math.round(toNumber(point.scorePercent) * 100) }));
  const problems = templateProblems({ name: basics.name, sections: shapedSections, ratingScale: shapedScale, kinds: basics.kinds });
  const totalWeight = shapedSections.filter((section) => section.kind === "rating" && Number.isFinite(section.weight)).reduce((sum, section) => sum + section.weight, 0);

  const patchSection = (index: number, change: Partial<SectionDraft>) => setSections((current) => current.map((section, position) => (position === index ? { ...section, ...change } : section)));
  const patchPoint = (index: number, change: Partial<PointDraft>) => setScale((current) => current.map((point, position) => (position === index ? { ...point, ...change } : point)));
  const move = (index: number, by: number) =>
    setSections((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const toggle = <T,>(list: readonly T[], item: T, on: boolean): T[] => (on ? [...new Set([...list, item])] : list.filter((entry) => entry !== item));

  function save() {
    setSaved(false);
    startTransition(async () => {
      const result = await saveReviewTemplateAction({
        templateId: draft.id ?? "",
        name: basics.name,
        nameEn: basics.nameEn,
        description: basics.description,
        kinds: basics.kinds,
        isActive: basics.isActive,
        sections: shapedSections.map((section) => ({ ...section, titleEn: section.titleEn ?? "" })),
        ratingScale: scale.map((point) => ({ value: point.value, label: point.label, labelEn: point.labelEn, scorePercent: point.scorePercent.replace(",", ".") })),
      });
      if (result.ok) {
        setErrorKey(null);
        setSaved(true);
        if (!draft.id) router.push(`/performance/admin/templates/${result.data.id}`);
        else router.refresh();
      } else setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <TableCard>
        <TableCardHeader title={t("basics")} />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">{t("name")}</Label>
            <Input id="template-name" value={basics.name} maxLength={200} disabled={!editable} onChange={(event) => setBasics((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name-en">{t("nameEn")}</Label>
            <Input id="template-name-en" value={basics.nameEn} maxLength={200} disabled={!editable} onChange={(event) => setBasics((current) => ({ ...current, nameEn: event.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="template-description">{t("description")}</Label>
            <Textarea id="template-description" rows={2} value={basics.description} maxLength={2000} disabled={!editable} onChange={(event) => setBasics((current) => ({ ...current, description: event.target.value }))} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("kinds")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {REVIEW_CYCLE_KINDS.map((kind) => (
                <Label key={kind} className="flex items-center gap-2 font-normal">
                  <Checkbox checked={basics.kinds.includes(kind)} disabled={!editable} onCheckedChange={(checked) => setBasics((current) => ({ ...current, kinds: toggle(current.kinds, kind, checked === true) }))} />
                  {tCycle(`kinds.${kind}`)}
                </Label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("kindsHint")}</p>
          </fieldset>
          <Label className="flex items-center gap-2 self-start font-normal">
            <Switch checked={basics.isActive} disabled={!editable} onCheckedChange={(checked) => setBasics((current) => ({ ...current, isActive: checked === true }))} />
            {t("active")}
          </Label>
        </div>
      </TableCard>

      <TableCard>
        <TableCardHeader
          title={t("sections")}
          count={sections.length || null}
          description={t("sectionsHint")}
          actions={
            editable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSections((current) => [...current, { key: freeKey(current), title: "", titleEn: null, kind: "rating", weight: "1", required: true, askedOf: ["self", "manager"] }])}>
                {t("addSection")}
              </Button>
            ) : null
          }
        />
        <List numbered>
          {sections.map((section, index) => {
            const weight = section.kind === "rating" ? toNumber(section.weight) : 0;
            const share = totalWeight > 0 && Number.isFinite(weight) && weight > 0 ? Math.round((weight / totalWeight) * 1000) / 10 : null;
            return (
              <ListItem key={index} className="flex-col items-stretch gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`section-${index}-title`}>{t("sectionTitle")}</Label>
                  <Input id={`section-${index}-title`} value={section.title} maxLength={300} disabled={!editable} onChange={(event) => patchSection(index, { title: event.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem_7rem]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`section-${index}-title-en`}>{t("sectionTitleEn")}</Label>
                    <Input id={`section-${index}-title-en`} value={section.titleEn ?? ""} maxLength={300} disabled={!editable} onChange={(event) => patchSection(index, { titleEn: event.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`section-${index}-kind`}>{t("sectionKind")}</Label>
                    <Select id={`section-${index}-kind`} value={section.kind} disabled={!editable} onChange={(event) => patchSection(index, { kind: event.target.value as ReviewSectionKind })}>
                      {REVIEW_SECTION_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`sectionKinds.${kind}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {section.kind === "rating" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`section-${index}-weight`}>{t("weight")}</Label>
                      <Input id={`section-${index}-weight`} inputMode="numeric" value={section.weight} maxLength={4} disabled={!editable} onChange={(event) => patchSection(index, { weight: event.target.value })} />
                      {share !== null ? <span className="text-xs text-muted-foreground tabular-nums">{t("weightShare", { share })}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm text-muted-foreground">{t("askedOf")}</span>
                  {REVIEW_FORM_KINDS.map((kind: ReviewFormKind) => (
                    <Label key={kind} className="flex items-center gap-2 font-normal">
                      <Checkbox checked={section.askedOf.includes(kind)} disabled={!editable} onCheckedChange={(checked) => patchSection(index, { askedOf: REVIEW_FORM_KINDS.filter((each) => (each === kind ? checked === true : section.askedOf.includes(each))) })} />
                      {tForm(`kind.${kind}`)}
                    </Label>
                  ))}
                  <Label className="flex items-center gap-2 font-normal">
                    <Switch checked={section.required} disabled={!editable} onCheckedChange={(checked) => patchSection(index, { required: checked === true })} />
                    {t("required")}
                  </Label>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`section-${index}-key`}>{t("key")}</Label>
                    <Input id={`section-${index}-key`} className="w-32 font-mono" value={section.key} maxLength={40} disabled={!editable} onChange={(event) => patchSection(index, { key: event.target.value.trim().toLowerCase() })} />
                  </div>
                  {editable ? (
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp")}>
                        <ArrowUpIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={index === sections.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown")}>
                        <ArrowDownIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSections((current) => current.filter((_, position) => position !== index))} aria-label={t("remove")}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </ListItem>
            );
          })}
        </List>
        {sections.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">{t("noSections")}</p> : null}
      </TableCard>

      <TableCard>
        <TableCardHeader
          title={t("scale")}
          count={scale.length || null}
          description={t("scaleHint")}
          actions={
            editable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setScale((current) => [...current, { value: String(current.length + 1), label: "", labelEn: "", scorePercent: "" }])}>
                {t("addPoint")}
              </Button>
            ) : null
          }
        />
        <List>
          {scale.map((point, index) => (
            <ListItem key={index} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[5rem_1fr_1fr_7rem_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`point-${index}-value`}>{t("pointValue")}</Label>
                <Input id={`point-${index}-value`} inputMode="numeric" value={point.value} maxLength={3} disabled={!editable} onChange={(event) => patchPoint(index, { value: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`point-${index}-percent`}>{t("pointPercent")}</Label>
                <Input id={`point-${index}-percent`} inputMode="decimal" value={point.scorePercent} maxLength={7} disabled={!editable} onChange={(event) => patchPoint(index, { scorePercent: event.target.value })} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1 sm:row-start-1 sm:col-start-2">
                <Label htmlFor={`point-${index}-label`}>{t("pointLabel")}</Label>
                <Input id={`point-${index}-label`} value={point.label} maxLength={120} disabled={!editable} onChange={(event) => patchPoint(index, { label: event.target.value })} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1 sm:row-start-1 sm:col-start-3">
                <Label htmlFor={`point-${index}-label-en`}>{t("pointLabelEn")}</Label>
                <Input id={`point-${index}-label-en`} value={point.labelEn} maxLength={120} disabled={!editable} onChange={(event) => patchPoint(index, { labelEn: event.target.value })} />
              </div>
              {editable ? (
                <Button type="button" variant="ghost" size="icon-sm" className="justify-self-end" onClick={() => setScale((current) => current.filter((_, position) => position !== index))} aria-label={t("remove")}>
                  <Trash2Icon />
                </Button>
              ) : null}
            </ListItem>
          ))}
        </List>
      </TableCard>

      {editable ? (
        <div className="flex flex-col gap-3">
          {problems.length > 0 ? (
            <Alert variant="warning">
              <p className="font-medium">{t("problems")}</p>
              <ul className="list-disc pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{tErrors(problem)}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("snapshotNote")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="lg" className="w-full md:w-auto" disabled={pending || problems.length > 0} onClick={save}>
              {t("save")}
            </Button>
            {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
          </div>
          <FormError namespace={ERRORS} errorKey={errorKey} />
        </div>
      ) : null}
    </div>
  );
}
