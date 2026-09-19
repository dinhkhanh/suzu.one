"use client";
import { useTranslations } from "next-intl";
import { useTransition, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { bulkMapAction, commitDeviceLogAction, mapDeviceUserAction, recomputeTimesheetsAction, saveDeviceAction, savePolicyAction, saveProfileAction, stageDeviceLogAction, unmapDeviceUserAction } from "../device-actions";
import type { DeviceMapping } from "../engine/device-log";

type Option = { id: string; name: string };
const ERRORS = "attendance.devices.errors";

function Saved({ show, label }: { show: boolean; label: string }) {
  return show ? <span className="text-sm text-muted-foreground">{label}</span> : null;
}

function EntitySelect({ entities, canGroup, label, groupLabel, defaultValue, disabled }: { entities: Option[]; canGroup: boolean; label: string; groupLabel: string; defaultValue?: string | null; disabled?: boolean }) {
  return (
    <Field name="entityId" label={label}>
      <Select id="entityId" name="entityId" defaultValue={defaultValue ?? (canGroup ? "" : entities[0]?.id)} disabled={disabled}>
        {canGroup ? <option value="">{groupLabel}</option> : null}
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export type ProfileFormValue = { id: string; entityId: string | null; name: string; deviceModel: string | null; fileKind: "csv" | "xlsx" | "dat"; mapping: DeviceMapping; isActive: boolean };

export function ProfileForm({ profile, entities, canGroup }: { profile?: ProfileFormValue; entities: Option[]; canGroup: boolean }) {
  const t = useTranslations("attendance.devices");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveProfileAction, { extra: profile ? { id: profile.id } : {} });
  const mapping = profile?.mapping;
  const column = (name: "userId" | "timestamp" | "time" | "direction") => (
    <div className="grid grid-cols-[1fr_5rem] gap-2">
      <Field name={`${name}Header`} label={t(`profile.${name}Header`)}>
        <Input id={`${name}Header`} name={`${name}Header`} defaultValue={mapping?.[name]?.header ?? ""} maxLength={80} />
      </Field>
      <Field name={`${name}Position`} label={t("profile.position")}>
        <Input id={`${name}Position`} name={`${name}Position`} type="number" min={1} max={50} defaultValue={mapping?.[name]?.position ?? ""} />
      </Field>
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="name" label={t("profile.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={profile?.name} />
          </Field>
          <Field name="deviceModel" label={t("profile.deviceModel")}>
            <Input id="deviceModel" name="deviceModel" maxLength={120} defaultValue={profile?.deviceModel ?? ""} />
          </Field>
          <Field name="fileKind" label={t("profile.fileKind")}>
            <Select id="fileKind" name="fileKind" defaultValue={profile?.fileKind ?? "csv"}>
              {(["csv", "xlsx", "dat"] as const).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`profile.fileKinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} defaultValue={profile?.entityId} disabled={!!profile} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hasHeader" defaultChecked={mapping?.hasHeader ?? true} /> {t("profile.hasHeader")}
        </label>
        <p className="text-xs text-muted-foreground">{t("profile.columnsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {column("userId")}
          {column("timestamp")}
          {column("time")}
          {column("direction")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="timestampFormat" label={t("profile.timestampFormat")}>
            <Input id="timestampFormat" name="timestampFormat" required defaultValue={mapping?.timestampFormat ?? "YYYY-MM-DD HH:mm:ss"} maxLength={40} />
          </Field>
          <Field name="directionCodes" label={t("profile.directionCodes")}>
            <Input id="directionCodes" name="directionCodes" defaultValue={Object.entries(mapping?.directionCodes ?? { "0": "in", "1": "out" }).map(([code, direction]) => `${code}=${direction}`).join(", ")} maxLength={400} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="inferDirection" defaultChecked={mapping?.inferDirection ?? true} /> {t("profile.inferDirection")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked={profile?.isActive ?? true} /> {t("active")}
          </label>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Saved show={saved} label={t("saved")} />
      </div>
    </form>
  );
}

export type DeviceFormValue = { id: string; entityId: string; name: string; model: string | null; serialNumber: string | null; locationId: string | null; profileId: string; isActive: boolean };

export function DeviceForm({ device, entities, profiles, locations }: { device?: DeviceFormValue; entities: Option[]; profiles: (Option & { entityId: string | null })[]; locations: (Option & { entityId: string })[] }) {
  const t = useTranslations("attendance.devices");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveDeviceAction, { extra: device ? { id: device.id, entityId: device.entityId } : {} });
  const [entityId, setEntityId] = useState(device?.entityId ?? entities[0]?.id ?? "");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="name" label={t("device.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={device?.name} />
          </Field>
          <Field name="entityId" label={t("device.entity")}>
            <Select id="entityId" name="entityId" value={entityId} onChange={(event) => setEntityId(event.target.value)} disabled={!!device}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="profileId" label={t("device.profile")}>
            <Select id="profileId" name="profileId" defaultValue={device?.profileId} required>
              {profiles.filter((profile) => profile.entityId === null || profile.entityId === entityId).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="model" label={t("device.model")}>
            <Input id="model" name="model" maxLength={120} defaultValue={device?.model ?? ""} />
          </Field>
          <Field name="serialNumber" label={t("device.serialNumber")}>
            <Input id="serialNumber" name="serialNumber" maxLength={80} defaultValue={device?.serialNumber ?? ""} />
          </Field>
          <Field name="locationId" label={t("device.location")}>
            <Select id="locationId" name="locationId" defaultValue={device?.locationId ?? ""}>
              <option value="">—</option>
              {locations.filter((location) => location.entityId === entityId).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={device?.isActive ?? true} /> {t("active")}
        </label>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Saved show={saved} label={t("saved")} />
      </div>
    </form>
  );
}

export function MapUserForm({ deviceId, deviceUserId, people }: { deviceId: string; deviceUserId?: string; people: Option[] }) {
  const t = useTranslations("attendance.devices");
  const { onSubmit, pending, errorKey, saved } = useActionForm(mapDeviceUserAction, { extra: { deviceId, ...(deviceUserId ? { deviceUserId } : {}) } });
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-wrap items-end gap-2">
      {deviceUserId ? null : (
        <Field name="deviceUserId" label={t("map.deviceUserId")}>
          <Input id="deviceUserId" name="deviceUserId" required maxLength={40} className="w-28" />
        </Field>
      )}
      <Field name="personId" label={deviceUserId ? t("map.personFor", { id: deviceUserId }) : t("map.person")}>
        <Select id={`personId-${deviceUserId ?? "new"}`} name="personId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t("map.save")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export function BulkMapForm({ deviceId }: { deviceId: string }) {
  const t = useTranslations("attendance.devices");
  const { onSubmit, pending, errorKey, saved, details } = useActionForm(bulkMapAction, { extra: { deviceId } });
  const problems = Array.isArray(details) ? (details as { line: number; code: string }[]) : [];
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("map.bulkHint")}</p>
      <textarea name="lines" required rows={5} className="rounded-md border bg-background p-2 font-mono text-sm" placeholder={"17, SZM-0004\n21, SZM-0007"} />
      <FormError namespace={ERRORS} errorKey={errorKey} />
      {problems.length > 0 ? (
        <ul className="text-sm text-destructive">
          {problems.map((problem) => (
            <li key={`${problem.line}-${problem.code}`}>
              {t("map.line", { line: problem.line })}: {t(`errors.${problem.code}`)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {t("map.bulkSave")}
        </Button>
        <Saved show={saved} label={t("saved")} />
      </div>
    </form>
  );
}

export function UnmapButton({ id, label, confirm }: { id: string; label: string; confirm: string }) {
  const { onSubmit, pending } = useActionForm(unmapDeviceUserAction, { extra: { id } });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(confirm)) onSubmit(event);
        else event.preventDefault();
      }}
    >
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function DeviceLogImport({ devices, title }: { devices: (Option & { accept: string })[]; title: string }) {
  const t = useTranslations("attendance.devices");
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const accept = devices.find((device) => device.id === deviceId)?.accept ?? ".csv";
  return (
    <ImportWizard title={title} accept={accept} stageAction={stageDeviceLogAction} commitAction={commitDeviceLogAction}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("import.device")}</span>
        <Select name="deviceId" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </Select>
      </label>
    </ImportWizard>
  );
}

export type PolicyFormValue = { entityId: string | null; validFrom: string; mergeRule: "first_in_last_out" | "prefer_device" | "prefer_app"; graceLateMinutes: number; graceEarlyMinutes: number; roundingMinutes: number; otMinMinutes: number; otRequiresApproval: boolean; duplicateWindowMinutes: number; breakStart: string; dayBoundary: string; monthlyCorrectionCap: number | null };

export function PolicyForm({ policy, entities, canGroup, today }: { policy?: PolicyFormValue; entities: Option[]; canGroup: boolean; today: string }) {
  const t = useTranslations("attendance.policy");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(savePolicyAction, { extra: policy ? { entityId: policy.entityId ?? "" } : {} });
  const number = (name: keyof PolicyFormValue, max: number, fallback: number | "") => (
    <Field name={name} label={t(`fields.${name}`)}>
      <Input id={name} name={name} type="number" min={0} max={max} defaultValue={(policy?.[name] as number | null | undefined) ?? fallback} />
    </Field>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          {policy ? null : <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} />}
          <Field name="validFrom" label={t("fields.validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={policy ? today : `${today.slice(0, 7)}-01`} />
          </Field>
          <Field name="mergeRule" label={t("fields.mergeRule")}>
            <Select id="mergeRule" name="mergeRule" defaultValue={policy?.mergeRule ?? "first_in_last_out"}>
              {(["first_in_last_out", "prefer_device", "prefer_app"] as const).map((rule) => (
                <option key={rule} value={rule}>
                  {t(`mergeRules.${rule}`)}
                </option>
              ))}
            </Select>
          </Field>
          {number("graceLateMinutes", 120, 0)}
          {number("graceEarlyMinutes", 120, 0)}
          {number("roundingMinutes", 60, 0)}
          {number("otMinMinutes", 240, 30)}
          {number("duplicateWindowMinutes", 30, 3)}
          {number("monthlyCorrectionCap", 31, "")}
          <Field name="breakStart" label={t("fields.breakStart")}>
            <Input id="breakStart" name="breakStart" type="time" required defaultValue={policy?.breakStart ?? "12:00"} />
          </Field>
          <Field name="dayBoundary" label={t("fields.dayBoundary")}>
            <Input id="dayBoundary" name="dayBoundary" type="time" required defaultValue={policy?.dayBoundary ?? "04:00"} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="otRequiresApproval" defaultChecked={policy?.otRequiresApproval ?? true} /> {t("fields.otRequiresApproval")}
        </label>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("versionHint")}</p>
      <FormError namespace="attendance.policy.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Saved show={saved} label={t("saved")} />
      </div>
    </form>
  );
}

export function RecomputeButton({ entities, label, doneLabel, failedLabel }: { entities: Option[]; label: string; doneLabel: string; failedLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  if (entities.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {entities.length > 1 ? (
        <Select value={entityId} onChange={(event) => setEntityId(event.target.value)} aria-label={label}>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await recomputeTimesheetsAction({ entityId });
            setMessage(result.ok ? doneLabel.replace("{written}", String(result.data.written)).replace("{locked}", String(result.data.lockedSkipped)) : failedLabel);
          })
        }
      >
        {label}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </span>
  );
}
