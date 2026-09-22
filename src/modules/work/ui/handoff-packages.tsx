"use client";
// A team's hand-off packages (FR-PJM-40): per transition (from a state, or any, into a state) the
// fields, checks, link and file a move requires, and whether the receiver must accept it.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { HANDOFF_FIELD_TYPES, type HandoffFieldType, MAX_PACKAGE_CHECKS, MAX_PACKAGE_FIELDS } from "../engine/handoff";
import { deleteHandoffPackageAction, saveHandoffPackageAction } from "../handoff-actions";

type Result = { ok: boolean; error?: string; message?: string };
export type PackageView = { id: string; name: string; fromStateId: string | null; toStateId: string; fields: { key: string; label: string; type: HandoffFieldType; required: boolean }[]; checklist: { id: string; text: string }[]; requireLink: boolean; requireFile: boolean; requireAccept: boolean; isActive: boolean };
type State = { id: string; name: string };

export function HandoffPackageManager({ teamId, packages, states, canManage }: { teamId: string; packages: PackageView[]; states: State[]; canManage: boolean }) {
  const t = useTranslations("work.handoff.packages");
  const stateName = (id: string | null) => (id ? (states.find((state) => state.id === id)?.name ?? "—") : t("anyState"));
  return (
    <div className="flex flex-col gap-3">
      {packages.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {packages.map((pkg) => (
          <li key={pkg.id} className="rounded-xl border p-3 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-medium">{pkg.name}</span>
                <span className="text-muted-foreground">
                  {stateName(pkg.fromStateId)} → {stateName(pkg.toStateId)}
                </span>
                {pkg.requireAccept ? <Badge variant="secondary">{t("mustAccept")}</Badge> : null}
                {pkg.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                <span className="text-xs text-muted-foreground">{t("summary", { fields: pkg.fields.length, checks: pkg.checklist.length })}</span>
              </summary>
              <div className="pt-3">{canManage ? <PackageForm teamId={teamId} states={states} pkg={pkg} /> : <PackageReadOnly pkg={pkg} />}</div>
            </details>
          </li>
        ))}
      </ul>
      {canManage ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("create")}</summary>
          <div className="pt-3">
            <PackageForm teamId={teamId} states={states} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function PackageReadOnly({ pkg }: { pkg: PackageView }) {
  const t = useTranslations("work.handoff.packages");
  return (
    <ul className="list-disc pl-5 text-sm">
      {pkg.fields.map((field) => (
        <li key={field.key}>
          {field.label} ({t(`types.${field.type}`)}
          {field.required ? `, ${t("required")}` : ""})
        </li>
      ))}
      {pkg.checklist.map((check) => (
        <li key={check.id}>☐ {check.text}</li>
      ))}
      {pkg.requireLink ? <li>{t("requireLink")}</li> : null}
      {pkg.requireFile ? <li>{t("requireFile")}</li> : null}
    </ul>
  );
}

const newRowId = () => Math.random().toString(36).slice(2, 10);

function PackageForm({ teamId, states, pkg }: { teamId: string; states: State[]; pkg?: PackageView }) {
  const t = useTranslations("work.handoff.packages");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fields, setFields] = useState(() => (pkg?.fields ?? []).map((field) => ({ ...field, row: field.key })));
  const [checks, setChecks] = useState(() => (pkg?.checklist ?? []).map((check) => ({ ...check, row: check.id })));
  const run = (call: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        run(
          () =>
            saveHandoffPackageAction({
              packageId: pkg?.id ?? "",
              teamId,
              name: data.get("name"),
              fromStateId: data.get("fromStateId"),
              toStateId: data.get("toStateId"),
              fields: fields.map((field) => ({ key: field.key || "", label: field.label, type: field.type, required: field.required })),
              checklist: checks.map((check) => ({ id: check.id || "", text: check.text })),
              requireLink: data.get("requireLink") === "on",
              requireFile: data.get("requireFile") === "on",
              requireAccept: data.get("requireAccept") === "on",
              isActive: data.get("isActive") === "on",
            }),
          () => {
            if (!pkg) {
              form.reset();
              setFields([]);
              setChecks([]);
            }
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`name-${pkg?.id ?? "new"}`}>{t("name")}</Label>
          <Input id={`name-${pkg?.id ?? "new"}`} name="name" required maxLength={80} defaultValue={pkg?.name ?? ""} placeholder={t("namePlaceholder")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`from-${pkg?.id ?? "new"}`}>{t("from")}</Label>
          <Select id={`from-${pkg?.id ?? "new"}`} name="fromStateId" defaultValue={pkg?.fromStateId ?? ""}>
            <option value="">{t("anyState")}</option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`to-${pkg?.id ?? "new"}`}>{t("to")}</Label>
          <Select id={`to-${pkg?.id ?? "new"}`} name="toStateId" required defaultValue={pkg?.toStateId ?? ""}>
            <option value="" disabled>
              {t("pickState")}
            </option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("fields")}</legend>
        {fields.map((field, index) => (
          <div key={field.row} className="flex flex-wrap items-center gap-2">
            <Input aria-label={t("fieldLabel")} value={field.label} maxLength={80} required onChange={(event) => setFields(fields.map((row, at) => (at === index ? { ...row, label: event.target.value } : row)))} className="min-w-0 flex-1" />
            <Select aria-label={t("fieldType")} value={field.type} onChange={(event) => setFields(fields.map((row, at) => (at === index ? { ...row, type: event.target.value as HandoffFieldType } : row)))} className="w-32">
              {HANDOFF_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={field.required} onChange={(event) => setFields(fields.map((row, at) => (at === index ? { ...row, required: event.target.checked } : row)))} /> {t("required")}
            </label>
            <Button type="button" size="sm" variant="ghost" aria-label={t("remove")} onClick={() => setFields(fields.filter((_, at) => at !== index))}>
              ×
            </Button>
          </div>
        ))}
        {fields.length < MAX_PACKAGE_FIELDS ? (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setFields([...fields, { key: "", label: "", type: "text", required: true, row: newRowId() }])}>
            {t("addField")}
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("checklist")}</legend>
        {checks.map((check, index) => (
          <div key={check.row} className="flex items-center gap-2">
            <Input aria-label={t("checkText")} value={check.text} maxLength={200} required onChange={(event) => setChecks(checks.map((row, at) => (at === index ? { ...row, text: event.target.value } : row)))} className="min-w-0 flex-1" />
            <Button type="button" size="sm" variant="ghost" aria-label={t("remove")} onClick={() => setChecks(checks.filter((_, at) => at !== index))}>
              ×
            </Button>
          </div>
        ))}
        {checks.length < MAX_PACKAGE_CHECKS ? (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setChecks([...checks, { id: "", text: "", row: newRowId() }])}>
            {t("addCheck")}
          </Button>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="requireLink" defaultChecked={pkg?.requireLink ?? false} /> {t("requireLink")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="requireFile" defaultChecked={pkg?.requireFile ?? false} /> {t("requireFile")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="requireAccept" defaultChecked={pkg?.requireAccept ?? true} /> {t("requireAccept")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="isActive" defaultChecked={pkg?.isActive ?? true} /> {t("active")}
        </label>
      </div>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {tWork("save")}
        </Button>
        {pkg ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("deleteConfirm"))) run(() => deleteHandoffPackageAction({ packageId: pkg.id }));
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
