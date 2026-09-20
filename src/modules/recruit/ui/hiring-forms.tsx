"use client";
// Asking for a head, and answering the ask. The budget fields appear only for somebody who may
// read compensation — a team lead asks for a person and leaves the figure to whoever sets bands.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { decideHiringRequestAction, submitHiringRequestAction } from "../actions";
import { EMPLOYMENT_TYPES } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export function HiringRequestForm({
  entities,
  departments,
  people,
  canSetMoney,
  defaultEntityId,
  defaultDepartmentId,
}: {
  entities: { id: string; shortName: string | null; code: string }[];
  departments: { id: string; name: string }[];
  people: { id: string; fullName: string }[];
  canSetMoney: boolean;
  defaultEntityId: string | null;
  defaultDepartmentId: string | null;
}) {
  const t = useTranslations("recruit.form");
  const tRoot = useTranslations("recruit");
  const types = useTranslations("recruit.employmentType");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(submitHiringRequestAction, {
    onSuccess: (data) => router.push(`/recruit/hiring/${(data as { id: string }).id}`),
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="positionTitle" label={t("title")}>
            <Input id="positionTitle" name="positionTitle" required maxLength={200} />
          </Field>
          <Field name="headcount" label={t("headcount")}>
            <Input id="headcount" name="headcount" type="number" min={1} max={100} required defaultValue={1} />
          </Field>
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" required defaultValue={defaultEntityId ?? ""}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.shortName ?? entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="departmentId" label={t("department")}>
            <Select id="departmentId" name="departmentId" defaultValue={defaultDepartmentId ?? ""}>
              <option value="">—</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="jobLevel" label={t("jobLevel")}>
            <Input id="jobLevel" name="jobLevel" maxLength={80} />
          </Field>
          <Field name="employmentType" label={t("employmentType")}>
            <Select id="employmentType" name="employmentType" defaultValue="employee">
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {types(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="workLocation" label={t("workLocation")}>
            <Input id="workLocation" name="workLocation" maxLength={200} />
          </Field>
          <Field name="targetStartDate" label={t("targetStartDate")}>
            <Input id="targetStartDate" name="targetStartDate" type="date" />
          </Field>
          <Field name="hiringManagerPersonId" label={t("hiringManager")}>
            <Select id="hiringManagerPersonId" name="hiringManagerPersonId" defaultValue="">
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field name="reason" label={t("reason")}>
          <textarea id="reason" name="reason" rows={4} required maxLength={2000} className={textarea} />
        </Field>

        {canSetMoney ? (
          <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{tRoot("columns.budget")}</legend>
            <Field name="budgetMinVnd" label={t("budgetMin")}>
              <Input id="budgetMinVnd" name="budgetMinVnd" inputMode="numeric" />
            </Field>
            <Field name="budgetMaxVnd" label={t("budgetMax")}>
              <Input id="budgetMaxVnd" name="budgetMaxVnd" inputMode="numeric" />
            </Field>
          </fieldset>
        ) : (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{t("budgetHidden")}</p>
        )}
      </FieldErrors>

      <FormError namespace="recruit.errors" errorKey={errorKey} />
      <Button type="submit" disabled={pending}>
        {tRoot("newHiring")}
      </Button>
    </form>
  );
}

export function HiringDecisionForm({ requestId }: { requestId: string }) {
  const t = useTranslations("recruit.form");
  const actions = useTranslations("recruit.actions");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(decideHiringRequestAction, { extra: { requestId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <FieldErrors value={fieldErrors}>
        <Field name="comment" label={t("note")}>
          <Input id="comment" name="comment" maxLength={2000} />
        </Field>
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
          {actions("approve")}
        </Button>
        <Button type="submit" name="decision" value="return" size="sm" variant="outline" disabled={pending}>
          {actions("returnRequest")}
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="destructive" disabled={pending}>
          {actions("rejectRequest")}
        </Button>
      </div>
    </form>
  );
}
