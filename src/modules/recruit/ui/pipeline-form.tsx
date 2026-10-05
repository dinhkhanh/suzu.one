"use client";
// A hiring pipeline and its stages (FR-REC-02: stages configurable per job — an opening picks the
// pipeline that fits it). Every stage says which rung of the funnel it is, whatever it is called,
// so openings with different stage names still compare in the report.
//
// A stage's key is what applications stand on, so an existing stage keeps its own however it is
// renamed or moved; a new one is given one from its name here. Removing a stage somebody is still
// sitting in is refused by the server, by name — a pipeline edit never moves people.
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { slugify } from "@/lib/slug";
import { saveRecruitPipelineAction } from "../actions";
import { STAGE_CATEGORIES, type StageCategory } from "../enums";
import { RowControls, useRows } from "./row-editor";

export type PipelineDraft = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  stages: { key: string; name: string; nameEn: string | null; category: StageCategory }[];
} | null;

type StageRow = { key: string | null; name: string; nameEn: string; category: StageCategory };

/** Keys for the stages that have none yet: the name, snake-cased, made unique — the rule the action checks. */
function withKeys(rows: readonly StageRow[]) {
  const taken = new Set(rows.flatMap((row) => (row.key ? [row.key] : [])));
  return rows.map((row, index) => {
    if (row.key) return { ...row, key: row.key };
    const base = slugify(row.name, { separator: "_", maxLength: 28 }).replace(/^_+/, "");
    let key = base.length >= 2 ? base : `stage_${index + 1}`;
    for (let n = 2; taken.has(key); n += 1) key = `${base.length >= 2 ? base : "stage"}_${n}`;
    taken.add(key);
    return { ...row, key };
  });
}

export function PipelineForm({ pipeline }: { pipeline: PipelineDraft }) {
  const t = useTranslations("recruit");
  const tEditor = useTranslations("recruit.editor");
  const router = useRouter();
  const list = useRows<StageRow>(pipeline ? pipeline.stages.map((stage) => ({ key: stage.key, name: stage.name, nameEn: stage.nameEn ?? "", category: stage.category })) : [{ key: null, name: "", nameEn: "", category: "applied" }]);
  const stages = withKeys(list.rows).map((row) => ({ key: row.key, name: row.name, nameEn: row.nameEn.trim() || null, category: row.category }));
  const form = useActionForm(saveRecruitPipelineAction, {
    extra: { ...(pipeline ? { pipelineId: pipeline.id } : {}), stages },
    onSuccess: () => {
      if (!pipeline) list.reset([{ key: null, name: "", nameEn: "", category: "applied" }]);
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4 rounded-[14px] border border-border bg-background p-4">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="code" label={t("form.code")}>
            <Input id={`code-${pipeline?.id ?? "new"}`} name="code" defaultValue={pipeline?.code ?? ""} readOnly={!!pipeline} required maxLength={24} />
          </Field>
          <Field name="name" label={t("form.name")}>
            <Input id={`name-${pipeline?.id ?? "new"}`} name="name" defaultValue={pipeline?.name ?? ""} required maxLength={120} />
          </Field>
          <Field name="nameEn" label={t("pipelineEditor.nameEn")}>
            <Input id={`name-en-${pipeline?.id ?? "new"}`} name="nameEn" defaultValue={pipeline?.nameEn ?? ""} maxLength={120} />
          </Field>
        </div>
        <Field name="description" label={t("form.description")}>
          <Input id={`description-${pipeline?.id ?? "new"}`} name="description" defaultValue={pipeline?.description ?? ""} maxLength={500} />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox name="isDefault" value="on" defaultChecked={pipeline?.isDefault ?? false} />
            {t("pipelineEditor.isDefault")}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox name="isActive" value="on" defaultChecked={pipeline?.isActive ?? true} />
            {t("form.isActive")}
          </label>
        </div>
      </FieldErrors>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("pipelineEditor.stages")}</h3>
        <List>
          {list.rows.length === 0 ? <ListEmpty>{t("pipelineEditor.noStages")}</ListEmpty> : null}
          {list.rows.map((row, index) => (
            <ListItem key={row.rowId} className="flex-col items-stretch gap-2 py-3">
              <div className="flex items-start gap-2">
                <span className="w-5 shrink-0 pt-8 text-right font-mono text-xs text-faint tabular-nums">{index + 1}</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`stage-${pipeline?.id ?? "new"}-${index}`}>{t("form.name")}</Label>
                    <Input id={`stage-${pipeline?.id ?? "new"}-${index}`} value={row.name} required maxLength={80} onChange={(event) => list.update(row.rowId, { name: event.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`stage-en-${pipeline?.id ?? "new"}-${index}`}>{t("pipelineEditor.nameEn")}</Label>
                    <Input id={`stage-en-${pipeline?.id ?? "new"}-${index}`} value={row.nameEn} maxLength={80} onChange={(event) => list.update(row.rowId, { nameEn: event.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`stage-category-${pipeline?.id ?? "new"}-${index}`}>{t("pipelineEditor.category")}</Label>
                    <Select id={`stage-category-${pipeline?.id ?? "new"}-${index}`} value={row.category} onChange={(event) => list.update(row.rowId, { category: event.target.value as StageCategory })}>
                      {STAGE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {t(`stageCategory.${category}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <span className="pt-6">
                  <RowControls index={index} count={list.rows.length} onMove={(by) => list.move(index, by)} onRemove={() => list.remove(row.rowId)} removable={list.rows.length > 1} />
                </span>
              </div>
            </ListItem>
          ))}
        </List>
        <p className="text-xs text-muted-foreground">{t("pipelineEditor.hint")}</p>
      </div>

      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={list.rows.length >= 20} onClick={() => list.add({ key: null, name: "", nameEn: "", category: "screening" })}>
          <Plus aria-hidden data-icon="inline-start" />
          {t("pipelineEditor.addStage")}
        </Button>
        <Button type="submit" size="sm" disabled={form.pending}>
          {tEditor("save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{tEditor("saved")}</span> : null}
      </div>
    </form>
  );
}
