"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveAnnouncementAction } from "../actions";
import { type AudienceType, audienceKey } from "../enums";

type Option = { id: string; name: string };
export type AudienceChoices = { all: boolean; entities: Option[]; departments: Option[]; teams: Option[]; branches: Option[]; people: Option[] };
export type AnnouncementDraft = { id: string | null; title: string; body: string; kbPageId: string | null; pinned: boolean; mustAcknowledge: boolean; expiresAt: string; publishAt: string; audience: { key: string; label: string }[]; published: boolean };

/** Write or edit an announcement: text, who it is for, when it appears. "Publish" with a future time schedules it. */
export function AnnouncementForm({ draft, choices }: { draft: AnnouncementDraft; choices: AudienceChoices }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [list, setList] = useState(draft.audience);
  const types = ([["all", choices.all ? [{ id: "", name: "" }] : []], ["entity", choices.entities], ["department", choices.departments], ["team", choices.teams], ["branch", choices.branches], ["person", choices.people]] as [AudienceType, Option[]][]).filter(([, options]) => options.length > 0);
  const [type, setType] = useState<AudienceType>(types[0]?.[0] ?? "all");
  const [id, setId] = useState("");
  const options = types.find(([value]) => value === type)?.[1] ?? [];
  const form = useActionForm(saveAnnouncementAction, { extra: { id: draft.id ?? "", audience: list.map((row) => row.key) }, onSuccess: (data) => router.push(`/announcements/manage/${data.id}`) });

  function add() {
    if (type !== "all" && !id) return;
    const key = audienceKey(type, id);
    const label = type === "all" ? t("audience.all") : `${t(`audience.${type}`)}: ${options.find((option) => option.id === id)?.name ?? ""}`;
    setList((current) => [...current.filter((row) => row.key !== key), { key, label }]);
  }

  return (
    <form onSubmit={form.onSubmit} className="flex max-w-2xl flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("form.title")}>
          <Input id="title" name="title" required maxLength={200} defaultValue={draft.title} />
        </Field>
        <Field name="body" label={t("form.body")}>
          <textarea id="body" name="body" required rows={10} maxLength={10000} defaultValue={draft.body} className="rounded-lg border bg-background px-2.5 py-1.5 text-sm" />
        </Field>
        <Field name="kbPageId" label={t("form.kbPage")}>
          <Input id="kbPageId" name="kbPageId" defaultValue={draft.kbPageId ? `/kb/pages/${draft.kbPageId}` : ""} placeholder="/kb/pages/…" />
        </Field>
        <Field name="audience" label={t("form.audience")}>
          <ul className="flex flex-col gap-1">
            {list.length === 0 ? <li className="text-sm text-muted-foreground">{t("form.audienceEmpty")}</li> : null}
            {list.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => setList((current) => current.filter((item) => item.key !== row.key))}>
                  {t("form.remove")}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t("form.audienceType")}
              value={type}
              onChange={(event) => {
                setType(event.target.value as AudienceType);
                setId("");
              }}
            >
              {types.map(([value]) => (
                <option key={value} value={value}>
                  {t(`audience.${value}`)}
                </option>
              ))}
            </Select>
            {type !== "all" ? (
              <Select aria-label={t("form.audienceName")} value={id} onChange={(event) => setId(event.target.value)}>
                <option value="">—</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={add}>
              {t("form.add")}
            </Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pinned" defaultChecked={draft.pinned} />
            {t("form.pinned")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="mustAcknowledge" defaultChecked={draft.mustAcknowledge} />
            {t("form.mustAcknowledge")}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="publishAt" label={t("form.publishAt")}>
            <Input id="publishAt" name="publishAt" type="datetime-local" defaultValue={draft.publishAt} />
          </Field>
          <Field name="expiresAt" label={t("form.expiresAt")}>
            <Input id="expiresAt" name="expiresAt" type="datetime-local" defaultValue={draft.expiresAt} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("form.scheduleHelp")}</p>
      </FieldErrors>
      <FormError namespace="comms.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="publish" disabled={form.pending}>
          {draft.published ? t("form.saveAndKeep") : t("form.publish")}
        </Button>
        {draft.published ? null : (
          <Button type="submit" name="intent" value="draft" variant="outline" disabled={form.pending}>
            {t("form.saveDraft")}
          </Button>
        )}
      </div>
    </form>
  );
}
