"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { archiveSpaceAction, createSpaceAction, updateSpaceAction } from "../actions";
import { SPACE_KINDS, type SpaceKind } from "../enums";

type Option = { id: string; name: string };

function KindSelect({ defaultValue }: { defaultValue: SpaceKind }) {
  const t = useTranslations("kb");
  return (
    <Select id="kind" name="kind" defaultValue={defaultValue}>
      {SPACE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {t(`space.kind.${kind}`)}
        </option>
      ))}
    </Select>
  );
}

/** `entities` are the ones the viewer manages; `groupWide` says whether they may open a space for everyone. */
export function NewSpaceForm({ entities, units, groupWide }: { entities: Option[]; units: Option[]; groupWide: boolean }) {
  const t = useTranslations("kb");
  const router = useRouter();
  // A new space starts readable by all staff; its manager narrows or widens that on the space page.
  const form = useActionForm(createSpaceAction, { extra: { access: [{ subjectKey: "all", level: "view" }] }, onSuccess: (data) => router.push(`/kb/spaces/${data.key}`) });
  return (
    <form onSubmit={form.onSubmit} className="flex max-w-2xl flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label={t("fields.spaceName")}>
            <Input id="name" name="name" required maxLength={120} />
          </Field>
          <Field name="key" label={t("fields.spaceKey")}>
            <Input id="key" name="key" required pattern="[a-z0-9][a-z0-9-]{1,39}" placeholder="so-tay" />
          </Field>
          {units.length > 0 ? (
            <Field name="ownerUnitId" label={t("fields.ownerUnit")}>
              <Select id="ownerUnitId" name="ownerUnitId" defaultValue="">
                <option value="">{t("space.noOwnerUnit")}</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field name="entityId" label={t("fields.entity")}>
            <Select id="entityId" name="entityId" defaultValue={groupWide ? "" : entities[0]?.id}>
              {groupWide ? <option value="">{t("space.groupWide")}</option> : null}
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="kind" label={t("fields.kind")}>
            <KindSelect defaultValue="open" />
          </Field>
          <Field name="icon" label={t("fields.icon")}>
            <Input id="icon" name="icon" maxLength={8} placeholder="📘" />
          </Field>
          <Field name="sortOrder" label={t("fields.sortOrder")}>
            <Input id="sortOrder" name="sortOrder" type="number" min={0} max={9999} defaultValue={0} />
          </Field>
        </div>
        <Field name="description" label={t("fields.description")}>
          <Input id="description" name="description" maxLength={500} />
        </Field>
      </FieldErrors>
      <FormError namespace="kb.errors" errorKey={form.errorKey} />
      <Button type="submit" disabled={form.pending} className="w-fit">
        {t("space.create")}
      </Button>
    </form>
  );
}

export function SpaceSettingsForm({ space }: { space: { id: string; name: string; description: string | null; icon: string | null; kind: SpaceKind; sortOrder: number } }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const form = useActionForm(updateSpaceAction, { extra: { spaceId: space.id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label={t("fields.spaceName")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={space.name} />
          </Field>
          <Field name="kind" label={t("fields.kind")}>
            <KindSelect defaultValue={space.kind} />
          </Field>
          <Field name="icon" label={t("fields.icon")}>
            <Input id="icon" name="icon" maxLength={8} defaultValue={space.icon ?? ""} />
          </Field>
          <Field name="sortOrder" label={t("fields.sortOrder")}>
            <Input id="sortOrder" name="sortOrder" type="number" min={0} max={9999} defaultValue={space.sortOrder} />
          </Field>
        </div>
        <Field name="description" label={t("fields.description")}>
          <Input id="description" name="description" maxLength={500} defaultValue={space.description ?? ""} />
        </Field>
      </FieldErrors>
      <FormError namespace="kb.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export function ArchiveSpaceButton({ spaceId, archived }: { spaceId: string; archived: boolean }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!archived && !window.confirm(t("space.archiveConfirm"))) return;
        startTransition(async () => {
          await archiveSpaceAction({ spaceId, archived: !archived });
          router.refresh();
        });
      }}
    >
      {archived ? t("space.restore") : t("space.archive")}
    </Button>
  );
}
