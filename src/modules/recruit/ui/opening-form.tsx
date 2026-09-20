"use client";
// Writing the advertisement. The salary band is only rendered when the server says the viewer may
// read it (`canSetMoney`) — and the action drops the fields anyway if it is posted by hand, so a
// form that never shows a band cannot wipe one either.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createOpeningAction, updateOpeningAction } from "../actions";
import { EMPLOYMENT_TYPES, type EmploymentType, WORK_MODES, type WorkMode } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export type OpeningFormValue = {
  id: string | null;
  title: string;
  titleEn: string | null;
  entityId: string;
  departmentId: string | null;
  teamId: string | null;
  positionName: string | null;
  jobLevel: string | null;
  employmentType: EmploymentType;
  workMode: WorkMode;
  workLocation: string | null;
  headcount: number;
  description: string;
  requirements: string;
  benefits: string;
  pipelineId: string;
  targetStartDate: string | null;
  salaryMinVnd: number | null;
  salaryMaxVnd: number | null;
  salaryPublic: boolean;
};

export function OpeningForm({
  value,
  entities,
  departments,
  pipelines,
  canSetMoney,
  hiringRequestId,
}: {
  value: OpeningFormValue | null;
  entities: { id: string; shortName: string | null; code: string }[];
  departments: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  canSetMoney: boolean;
  hiringRequestId?: string | null;
}) {
  const t = useTranslations("recruit.form");
  const tRoot = useTranslations("recruit");
  const types = useTranslations("recruit.employmentType");
  const modes = useTranslations("recruit.workMode");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(value?.id ? updateOpeningAction : createOpeningAction, {
    extra: value?.id ? { openingId: value.id } : hiringRequestId ? { hiringRequestId } : {},
    onSuccess: (data) => router.push(`/recruit/${(data as { id: string }).id}`),
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="title" label={t("title")}>
            <Input id="title" name="title" required maxLength={200} defaultValue={value?.title ?? ""} />
          </Field>
          <Field name="titleEn" label={t("titleEn")}>
            <Input id="titleEn" name="titleEn" maxLength={200} defaultValue={value?.titleEn ?? ""} />
          </Field>
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" required defaultValue={value?.entityId ?? ""}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.shortName ?? entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="departmentId" label={t("department")}>
            <Select id="departmentId" name="departmentId" defaultValue={value?.departmentId ?? ""}>
              <option value="">—</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="positionName" label={t("positionName")}>
            <Input id="positionName" name="positionName" maxLength={200} defaultValue={value?.positionName ?? ""} />
          </Field>
          <Field name="jobLevel" label={t("jobLevel")}>
            <Input id="jobLevel" name="jobLevel" maxLength={80} defaultValue={value?.jobLevel ?? ""} />
          </Field>
          <Field name="employmentType" label={t("employmentType")}>
            <Select id="employmentType" name="employmentType" defaultValue={value?.employmentType ?? "employee"}>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {types(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="workMode" label={t("workMode")}>
            <Select id="workMode" name="workMode" defaultValue={value?.workMode ?? "onsite"}>
              {WORK_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {modes(mode)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="workLocation" label={t("workLocation")}>
            <Input id="workLocation" name="workLocation" maxLength={200} defaultValue={value?.workLocation ?? ""} />
          </Field>
          <Field name="headcount" label={t("headcount")}>
            <Input id="headcount" name="headcount" type="number" min={1} max={100} required defaultValue={value?.headcount ?? 1} />
          </Field>
          <Field name="pipelineId" label={t("pipeline")}>
            <Select id="pipelineId" name="pipelineId" required defaultValue={value?.pipelineId ?? pipelines[0]?.id ?? ""}>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="targetStartDate" label={t("targetStartDate")}>
            <Input id="targetStartDate" name="targetStartDate" type="date" defaultValue={value?.targetStartDate ?? ""} />
          </Field>
        </div>

        <Field name="description" label={t("description")}>
          <textarea id="description" name="description" rows={6} maxLength={20_000} className={textarea} defaultValue={value?.description ?? ""} />
        </Field>
        <Field name="requirements" label={t("requirements")}>
          <textarea id="requirements" name="requirements" rows={5} maxLength={20_000} className={textarea} defaultValue={value?.requirements ?? ""} />
        </Field>
        <Field name="benefits" label={t("benefits")}>
          <textarea id="benefits" name="benefits" rows={4} maxLength={20_000} className={textarea} defaultValue={value?.benefits ?? ""} />
        </Field>

        {canSetMoney ? (
          <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{tRoot("columns.salary")}</legend>
            <Field name="salaryMinVnd" label={t("salaryMin")}>
              <Input id="salaryMinVnd" name="salaryMinVnd" inputMode="numeric" defaultValue={value?.salaryMinVnd ?? ""} />
            </Field>
            <Field name="salaryMaxVnd" label={t("salaryMax")}>
              <Input id="salaryMaxVnd" name="salaryMaxVnd" inputMode="numeric" defaultValue={value?.salaryMaxVnd ?? ""} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="salaryPublic" defaultChecked={value?.salaryPublic ?? false} className="size-4" />
              {t("salaryPublic")}
            </label>
          </fieldset>
        ) : (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{t("salaryHidden")}</p>
        )}
      </FieldErrors>

      <FormError namespace="recruit.errors" errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {tRoot("save")}
        </Button>
      </div>
    </form>
  );
}
