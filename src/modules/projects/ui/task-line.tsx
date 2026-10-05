"use client";
// "Fills register line" on a task's own page (FR-PJM-05, 06): which promise of the project this
// task is a unit of. The route mounts it among the task's sections, as it mounts the time log: the
// work module's screens know nothing of the register. Whoever may edit the project's plan picks
// the line — the project's open lines, a retainer's current month first; anyone else who may read
// the plan reads it. The action re-checks.
import { useTranslations } from "next-intl";
import { Field } from "@/components/forms/field";
import { Select } from "@/components/ui/select";
import { setTaskLineAction } from "../line-actions";
import { ActionForm } from "./plan-forms";

type Option = { id: string; label: string };

export function TaskLineField({ taskId, current, options, canEdit }: { taskId: string; current: string | null; options: Option[]; canEdit: boolean }) {
  const t = useTranslations("projects.taskLine");
  const line = options.find((option) => option.id === current);
  // Nothing to say: no line, and nobody here who could choose one.
  if (!canEdit && !line) return null;
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="section-label">{t("title")}</h2>
      {canEdit ? (
        options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ActionForm action={setTaskLineAction} extra={{ taskId }} submit={t("save")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field name="deliverableId" label={t("label")}>
              <Select id={`task-line-${taskId}`} name="deliverableId" defaultValue={current ?? ""} className="sm:w-80">
                <option value="">{t("none")}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        )
      ) : (
        <p className="text-sm">{line?.label}</p>
      )}
    </section>
  );
}
