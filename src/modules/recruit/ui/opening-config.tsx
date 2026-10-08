"use client";
// What an opening asks: the application form's own questions (FR-REC-03) and the interview kit its
// interviewers score against (FR-REC-06). Two list editors of the same shape. A row's key is never
// shown or typed: an existing row keeps the one its answers and scores are stored under, and the
// server gives a new row one from its label.
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveOpeningKitAction, saveOpeningQuestionsAction } from "../actions";
import type { OpeningQuestion, ScorecardCriterion } from "../enums";
import { OPENING_CONFIG_LIMITS, QUESTION_KINDS } from "../engine/opening-config";
import { RowControls, useRows } from "./row-editor";

type QuestionRow = { key: string | null; label: string; labelEn: string; kind: OpeningQuestion["kind"]; required: boolean; choices: string };

export function QuestionsEditor({ openingId, questions }: { openingId: string; questions: OpeningQuestion[] }) {
  const t = useTranslations("recruit.questions");
  const tEditor = useTranslations("recruit.editor");
  const router = useRouter();
  const list = useRows<QuestionRow>(questions.map((row) => ({ key: row.key, label: row.label, labelEn: row.labelEn ?? "", kind: row.kind, required: row.required, choices: row.choices.join("\n") })));
  const payload = list.rows.map((row) => ({
    key: row.key,
    label: row.label,
    labelEn: row.labelEn.trim() || null,
    kind: row.kind,
    required: row.required,
    choices:
      row.kind === "choice"
        ? row.choices
            .split("\n")
            .map((choice) => choice.trim())
            .filter(Boolean)
        : [],
  }));
  const form = useActionForm(saveOpeningQuestionsAction, { extra: { openingId, questions: JSON.stringify(payload) }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <List>
        {list.rows.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
        {list.rows.map((row, index) => (
          <ListItem key={row.rowId} className="flex-col items-stretch gap-2 py-3">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`question-${index}`}>{t("label")}</Label>
                <Input id={`question-${index}`} value={row.label} maxLength={OPENING_CONFIG_LIMITS.label} required onChange={(event) => list.update(row.rowId, { label: event.target.value })} />
              </div>
              <RowControls index={index} count={list.rows.length} onMove={(by) => list.move(index, by)} onRemove={() => list.remove(row.rowId)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`question-en-${index}`}>{t("labelEn")}</Label>
              <Input id={`question-en-${index}`} value={row.labelEn} maxLength={OPENING_CONFIG_LIMITS.label} onChange={(event) => list.update(row.rowId, { labelEn: event.target.value })} />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-40 flex-col gap-1.5">
                <Label htmlFor={`question-kind-${index}`}>{t("kind")}</Label>
                <Select id={`question-kind-${index}`} value={row.kind} onChange={(event) => list.update(row.rowId, { kind: event.target.value as QuestionRow["kind"] })}>
                  {QUESTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`kinds.${kind}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={row.required} onCheckedChange={(checked) => list.update(row.rowId, { required: checked === true })} />
                {t("required")}
              </label>
            </div>
            {row.kind === "choice" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`question-choices-${index}`}>{t("choices")}</Label>
                <Textarea id={`question-choices-${index}`} rows={3} value={row.choices} onChange={(event) => list.update(row.rowId, { choices: event.target.value })} />
                <p className="text-xs text-muted-foreground">{t("choicesHint")}</p>
              </div>
            ) : null}
          </ListItem>
        ))}
      </List>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={list.rows.length >= OPENING_CONFIG_LIMITS.questions} onClick={() => list.add({ key: null, label: "", labelEn: "", kind: "text", required: false, choices: "" })}>
          <Plus aria-hidden data-icon="inline-start" />
          {t("add")}
        </Button>
        <Button type="submit" size="sm" disabled={form.pending}>
          {tEditor("save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{tEditor("saved")}</span> : null}
      </div>
    </form>
  );
}

type CriterionRow = { key: string | null; label: string; labelEn: string; hint: string };

/**
 * The kit. Saved empty, the opening falls back to the module's four-point default — which is what
 * the editor shows to start from, so "nothing written yet" and "the default" look the same.
 */
export function KitEditor({ openingId, kit, fallback }: { openingId: string; kit: ScorecardCriterion[]; fallback: readonly ScorecardCriterion[] }) {
  const t = useTranslations("recruit.kit");
  const tEditor = useTranslations("recruit.editor");
  const router = useRouter();
  const start = (kit.length > 0 ? kit : fallback).map((row) => ({ key: row.key, label: row.label, labelEn: row.labelEn ?? "", hint: row.hint ?? "" }));
  const list = useRows<CriterionRow>(start);
  const payload = list.rows.map((row) => ({ key: row.key, label: row.label, labelEn: row.labelEn.trim() || null, hint: row.hint.trim() || null }));
  const form = useActionForm(saveOpeningKitAction, { extra: { openingId, kit: JSON.stringify(payload) }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{kit.length > 0 ? t("description") : t("usingDefault")}</p>
      <List>
        {list.rows.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
        {list.rows.map((row, index) => (
          <ListItem key={row.rowId} className="flex-col items-stretch gap-2 py-3">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`criterion-${index}`}>{t("label")}</Label>
                <Input id={`criterion-${index}`} value={row.label} maxLength={OPENING_CONFIG_LIMITS.label} required onChange={(event) => list.update(row.rowId, { label: event.target.value })} />
              </div>
              <RowControls index={index} count={list.rows.length} onMove={(by) => list.move(index, by)} onRemove={() => list.remove(row.rowId)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`criterion-en-${index}`}>{t("labelEn")}</Label>
                <Input id={`criterion-en-${index}`} value={row.labelEn} maxLength={OPENING_CONFIG_LIMITS.label} onChange={(event) => list.update(row.rowId, { labelEn: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`criterion-hint-${index}`}>{t("hint")}</Label>
                <Input id={`criterion-hint-${index}`} value={row.hint} maxLength={OPENING_CONFIG_LIMITS.hint} onChange={(event) => list.update(row.rowId, { hint: event.target.value })} />
              </div>
            </div>
          </ListItem>
        ))}
      </List>
      <p className="text-xs text-muted-foreground">{t("copiedNote")}</p>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={list.rows.length >= OPENING_CONFIG_LIMITS.criteria} onClick={() => list.add({ key: null, label: "", labelEn: "", hint: "" })}>
          <Plus aria-hidden data-icon="inline-start" />
          {t("add")}
        </Button>
        <Button type="submit" size="sm" disabled={form.pending}>
          {tEditor("save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{tEditor("saved")}</span> : null}
      </div>
    </form>
  );
}
