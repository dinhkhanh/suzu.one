import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { listDevices, listImportHistory } from "@/modules/attendance/devices";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { DeviceLogImport } from "@/modules/attendance/ui/device-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("importDeviceLogs");

const ACCEPT = { csv: ".csv", xlsx: ".xlsx", dat: ".dat,.txt,.log" } as const;

export default async function DeviceImportPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.devices");
  const format = await getFormatter();
  const [devices, history] = await Promise.all([listDevices(user.principal), listImportHistory(user.principal)]);
  const active = devices.filter((device) => device.isActive);
  const nameOf = new Map(devices.map((device) => [device.id, device.name]));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{t("import.description")}</p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>{t("import.notes.idempotent")}</li>
          <li>{t("import.notes.unmapped")}</li>
          <li>{t("import.notes.recompute")}</li>
        </ul>
        {active.length === 0 ? (
          <p className="text-sm">
            {t("import.noDevice")}{" "}
            <Link href="/attendance/devices" className="underline">
              {t("tabs.devices")}
            </Link>
          </p>
        ) : (
          <DeviceLogImport title={t("import.wizard")} devices={active.map((device) => ({ id: device.id, name: `${device.name} · ${device.entityName} (${device.profileName})`, accept: ACCEPT[device.fileKind] }))} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("import.history")}</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("import.historyEmpty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {history.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
              <span className="w-32 text-muted-foreground">{format.dateTime(row.createdAt, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" })}</span>
              <span className="font-medium">{row.fileName}</span>
              <span className="text-muted-foreground">{row.deviceId ? nameOf.get(row.deviceId) : ""}</span>
              <Badge dot variant={statusTone(row.status)}>{t(`import.statuses.${row.status}`)}</Badge>
              <span className="text-muted-foreground">
                {row.result ? t("import.result", { punches: row.result.punches ?? 0, skipped: row.result.skipped ?? 0, unmapped: row.result.unmapped ?? 0 }) : t("import.rows", { count: row.rowCount })}
              </span>
              <span className="text-xs text-muted-foreground">{row.byName}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
