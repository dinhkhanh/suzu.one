"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveLocationAction } from "../checkin-actions";

type Option = { id: string; name: string };
export type LocationFormValue = { id: string; entityId: string; name: string; address: string | null; latitude: number | null; longitude: number | null; radiusM: number | null; accuracyLimitM: number; ipAllowlist: string[]; rule: string; mode: string; isActive: boolean };

export function LocationForm({ location, entities }: { location?: LocationFormValue; entities: Option[] }) {
  const t = useTranslations("attendance.settings");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveLocationAction, { extra: location ? { id: location.id, entityId: location.entityId } : {}, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} key={!location && saved ? "saved" : "open"} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="name" label={t("locations.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={location?.name} />
          </Field>
          <Field name="entityId" label={t("locations.entity")}>
            <Select id="entityId" name="entityId" defaultValue={location?.entityId ?? entities[0]?.id} disabled={!!location}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="address" label={t("locations.address")}>
            <Input id="address" name="address" maxLength={300} defaultValue={location?.address ?? ""} />
          </Field>
          <Field name="latitude" label={t("locations.latitude")}>
            <Input id="latitude" name="latitude" inputMode="decimal" defaultValue={location?.latitude ?? ""} placeholder="10.7716" />
          </Field>
          <Field name="longitude" label={t("locations.longitude")}>
            <Input id="longitude" name="longitude" inputMode="decimal" defaultValue={location?.longitude ?? ""} placeholder="106.7048" />
          </Field>
          <Field name="radiusM" label={t("locations.radius")}>
            <Input id="radiusM" name="radiusM" type="number" min={10} max={50000} defaultValue={location?.radiusM ?? ""} placeholder="150" />
          </Field>
          <Field name="accuracyLimitM" label={t("locations.accuracyLimit")}>
            <Input id="accuracyLimitM" name="accuracyLimitM" type="number" min={10} max={5000} defaultValue={location?.accuracyLimitM ?? 100} />
          </Field>
          <Field name="rule" label={t("locations.rule")}>
            <Select id="rule" name="rule" defaultValue={location?.rule ?? "gps_or_ip"}>
              {(["gps_or_ip", "gps", "ip", "gps_and_ip"] as const).map((rule) => (
                <option key={rule} value={rule}>
                  {t(`locations.rules.${rule}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="mode" label={t("locations.mode")}>
            <Select id="mode" name="mode" defaultValue={location?.mode ?? "flag"}>
              {(["flag", "block"] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`locations.modes.${mode}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field name="ipAllowlist" label={t("locations.ipAllowlist")}>
          <textarea id="ipAllowlist" name="ipAllowlist" rows={2} defaultValue={location?.ipAllowlist.join("\n") ?? ""} placeholder="203.0.113.0/24" className="rounded-lg border bg-background px-2.5 py-1.5 font-mono text-sm" />
        </Field>
        <p className="text-xs text-muted-foreground">{t("locations.ipHint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={location?.isActive ?? true} className="size-4" />
          {t("active")}
        </label>
      </FieldErrors>
      <FormError namespace="attendance.settings.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
