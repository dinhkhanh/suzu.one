import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { PORTIONS } from "@/modules/leave/enums";
import { canFileLeaveFor, canManageLeaveOf } from "@/modules/leave/policy";
import { findLeaveRequest, type LeaveInput, type LeavePreview, previewLeave } from "@/modules/leave/requests";
import { leaveTypesFor } from "@/modules/leave/types";
import { SubmitLeaveForm } from "@/modules/leave/ui/request-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Request leave" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Filing in two steps without any client state: the dates go into the address ("Check"), the
// server shows what they cost on the person's own calendar, and only then can the request be sent.
// `?person=` lets HR file for someone; `?amends=` replaces an open request.
export default async function NewLeavePage(props: PageProps<"/leave/new">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const t = await getTranslations("leave");
  const format = await getFormatter();
  const locale = await getLocale();

  const amended = UUID.test(one(query.amends)) ? await findLeaveRequest(one(query.amends)) : undefined;
  const personId = amended?.personId ?? (UUID.test(one(query.person)) ? one(query.person) : user.person.id);
  const target = await getPersonTarget(personId);
  if (!target || !canFileLeaveFor(user.principal, target)) notFound();
  if (amended && amended.personId !== user.person.id && amended.filedByPersonId !== user.person.id && !canManageLeaveOf(user.principal, target)) notFound();
  const onBehalf = personId !== user.person.id;

  const types = await leaveTypesFor(target.entityId ?? null);
  const today = todayInVietnam();
  const typeId = UUID.test(one(query.type)) ? one(query.type) : (amended?.leaveTypeId ?? types[0]?.id ?? "");
  const from = DAY.test(one(query.from)) ? one(query.from) : (amended?.startDate ?? "");
  const to = DAY.test(one(query.to)) ? one(query.to) : (amended?.endDate ?? from);
  const portion = (value: string, fallback: string) => ((PORTIONS as readonly string[]).includes(value) ? value : fallback) as LeaveInput["startPortion"];
  const startPortion = portion(one(query.startPortion), amended?.startPortion ?? "full");
  const endPortion = portion(one(query.endPortion), amended?.endPortion ?? "full");
  const minutes = /^\d+$/.test(one(query.minutes)) ? Number(one(query.minutes)) : (amended?.minutes ?? null);

  let preview: LeavePreview | null = null;
  let previewError: string | null = null;
  if (typeId && from && to) {
    try {
      preview = await previewLeave(personId, { leaveTypeId: typeId, startDate: from, endDate: to, startPortion, endPortion, minutes, reason: null, attachmentFileId: null }, { filedByHr: onBehalf, ignoreRequestId: amended?.id ?? null });
    } catch (error) {
      previewError = error instanceof Error ? error.message : "generic";
    }
  }
  // The attachment is added in the next step; every other problem has to be fixed first.
  const blocking = preview?.problems.filter((problem) => problem !== "leave_attachment_required") ?? [];
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" });
  const typeName = (type: { name: string; nameEn: string | null }) => (locale === "en" && type.nameEn ? type.nameEn : type.name);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{amended ? t("request.amendTitle") : t("request.new")}</h1>
        <p className="text-sm text-muted-foreground">{onBehalf ? t("request.onBehalf") : t("request.hint")}</p>
      </header>

      <form method="get" className="flex flex-col gap-3 rounded-xl border p-4">
        {onBehalf && !amended ? <input type="hidden" name="person" value={personId} /> : null}
        {amended ? <input type="hidden" name="amends" value={amended.id} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">{t("request.type")}</Label>
          <Select id="type" name="type" defaultValue={typeId}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {typeName(type)}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">{t("request.from")}</Label>
            <Input id="from" name="from" type="date" required defaultValue={from || addDays(today, 3)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">{t("request.to")}</Label>
            <Input id="to" name="to" type="date" required defaultValue={to || addDays(today, 3)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startPortion">{t("request.startPortion")}</Label>
            <Select id="startPortion" name="startPortion" defaultValue={startPortion}>
              {PORTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`portions.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endPortion">{t("request.endPortion")}</Label>
            <Select id="endPortion" name="endPortion" defaultValue={endPortion}>
              {(["full", "am"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`portions.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minutes">{t("request.minutes")}</Label>
            <Input id="minutes" name="minutes" type="number" min={15} max={720} step={15} defaultValue={minutes ?? ""} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("request.portionHint")}</p>
        <div>
          <Button type="submit" variant="outline">
            {t("request.check")}
          </Button>
        </div>
      </form>

      {previewError ? <p role="alert" className="text-sm text-destructive">{t.has(`errors.${previewError}`) ? t(`errors.${previewError}`) : t("errors.generic")}</p> : null}

      {preview ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
          <h2 className="font-medium">
            {typeName(preview.type)} · {t("daysCount", { days: days(preview.counted.totalCenti) })}
          </h2>
          <p className="text-muted-foreground">{preview.counted.days.map((day) => `${date(day.date)}${day.portion === "full" ? "" : ` (${t(`portions.${day.portion}`)})`}`).join(" · ") || "—"}</p>
          {preview.type.tracksBalance ? (
            <p>
              {Object.entries(preview.availableByYear)
                .map(([year, centi]) => t("request.available", { year, days: days(centi) }))
                .join(" · ")}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("request.noBalance")}</p>
          )}
          {blocking.length > 0 ? (
            <ul role="alert" className="list-disc pl-5 text-destructive">
              {blocking.map((problem) => (
                <li key={problem}>{t.has(`errors.${problem}`) ? t(`errors.${problem}`) : problem}</li>
              ))}
            </ul>
          ) : null}
          {preview.conflicts.colleaguesAway.length > 0 ? (
            <div>
              <p className="font-medium">{t("request.colleaguesAway")}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {preview.conflicts.colleaguesAway.map((row) => (
                  <li key={row.name}>
                    {row.name}: {row.dates.map(date).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.conflicts.shortfalls.length > 0 ? (
            <p className="rounded-lg bg-muted p-2">
              {t("request.shortfall", { dates: preview.conflicts.shortfalls.map((row) => date(row.date)).join(", "), min: preview.conflicts.shortfalls[0].minPresent })}
            </p>
          ) : null}
        </section>
      ) : null}

      {preview ? (
        <SubmitLeaveForm
          key={`${typeId}:${from}:${to}:${startPortion}:${endPortion}:${minutes}`}
          draft={{ personId: onBehalf ? personId : null, leaveTypeId: typeId, startDate: from, endDate: to, startPortion, endPortion, minutes }}
          amends={amended?.id ?? null}
          needsAttachment={preview.type.requiresAttachment}
          disabled={blocking.length > 0}
        />
      ) : null}
      <Link href="/leave" className="text-sm underline-offset-4 hover:underline">
        {t("back")}
      </Link>
    </div>
  );
}
