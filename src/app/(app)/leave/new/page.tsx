import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { PORTIONS } from "@/modules/leave/enums";
import { canFileLeaveFor, canManageLeaveOf } from "@/modules/leave/policy";
import { findLeaveRequest, type LeaveInput, type LeavePreview, previewLeave } from "@/modules/leave/requests";
import { leaveTypesFor } from "@/modules/leave/types";
import { SubmitLeaveForm } from "@/modules/leave/ui/request-forms";
import { proposalDraft } from "@/modules/ai/service";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("requestLeave");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
/** Up to this many leave types are a row of chips; more are a list to pick from. */
const CHIP_LIMIT = 4;

// Filing in two steps without any client state: the dates go into the address ("Check"), the
// server shows what they cost on the person's own calendar, and only then can the request be sent.
// `?person=` lets HR file for someone; `?amends=` replaces an open request; `?proposal=` starts
// from the assistant's proposal of the asker's own (its dates are in the address, its reason here).
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
  const proposalId = !amended && !onBehalf && UUID.test(one(query.proposal)) ? one(query.proposal) : null;
  const proposed = proposalId ? await proposalDraft(user.person.id, proposalId, ["leave.request.submit"]) : null;
  const proposedReason = typeof proposed?.reason === "string" ? proposed.reason : undefined;

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

  // A chip is a link that keeps everything else typed so far in the address.
  const chips = types.length <= CHIP_LIMIT;
  const chipHref = (id: string) => {
    const params = new URLSearchParams();
    if (onBehalf && !amended) params.set("person", personId);
    if (amended) params.set("amends", amended.id);
    params.set("type", id);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("startPortion", startPortion);
    params.set("endPortion", endPortion);
    if (minutes !== null) params.set("minutes", String(minutes));
    if (proposalId) params.set("proposal", proposalId);
    return `/leave/new?${params.toString()}`;
  };

  return (
    <Page width="narrow">
      <PageHeader title={amended ? t("request.amendTitle") : t("request.new")} description={onBehalf ? t("request.onBehalf") : t("request.hint")} />

      <Card>
        <form method="get" className="flex flex-col gap-4 px-(--card-spacing)">
          {onBehalf && !amended ? <input type="hidden" name="person" value={personId} /> : null}
          {amended ? <input type="hidden" name="amends" value={amended.id} /> : null}
          {proposalId ? <input type="hidden" name="proposal" value={proposalId} /> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={chips ? undefined : "type"}>{t("request.type")}</Label>
            {chips ? (
              <>
                <input type="hidden" name="type" value={typeId} />
                <Segmented aria-label={t("request.type")} value={typeId} options={types.map((type) => ({ value: type.id, label: typeName(type), href: chipHref(type.id) }))} className="w-full overflow-x-auto [&>a]:flex-1" />
              </>
            ) : (
              <Select id="type" name="type" defaultValue={typeId}>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {typeName(type)}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">{t("request.from")}</Label>
              <DatePicker id="from" name="from" required defaultValue={from || addDays(today, 3)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">{t("request.to")}</Label>
              <DatePicker id="to" name="to" required defaultValue={to || addDays(today, 3)} />
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
            <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
              <Label htmlFor="minutes">{t("request.minutes")}</Label>
              <Input id="minutes" name="minutes" type="number" min={15} max={720} step={15} defaultValue={minutes ?? ""} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("request.portionHint")}</p>
          <div>
            <Button type="submit" variant={preview ? "outline" : "default"} className="w-full md:w-auto">
              {t("request.check")}
            </Button>
          </div>
        </form>
      </Card>

      {previewError ? <Alert variant="destructive">{t.has(`errors.${previewError}`) ? t(`errors.${previewError}`) : t("errors.generic")}</Alert> : null}

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {typeName(preview.type)} · {t("daysCount", { days: days(preview.counted.totalCenti) })}
            </CardTitle>
            <CardDescription>{preview.counted.days.map((day) => `${date(day.date)}${day.portion === "full" ? "" : ` (${t(`portions.${day.portion}`)})`}`).join(" · ") || "—"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {preview.type.tracksBalance ? (
              <p className="text-sm">
                {Object.entries(preview.availableByYear)
                  .map(([year, centi]) => t("request.available", { year, days: days(centi) }))
                  .join(" · ")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("request.noBalance")}</p>
            )}
            {blocking.length > 0 ? (
              <Alert variant="destructive">
                <ul className="flex flex-col gap-0.5">
                  {blocking.map((problem) => (
                    <li key={problem}>{t.has(`errors.${problem}`) ? t(`errors.${problem}`) : problem}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {preview.conflicts.colleaguesAway.length > 0 ? (
              <Alert variant="info">
                <div className="flex flex-col gap-0.5">
                  <AlertTitle>{t("request.colleaguesAway")}</AlertTitle>
                  <ul className="flex flex-col gap-0.5">
                    {preview.conflicts.colleaguesAway.map((row) => (
                      <li key={row.personId}>
                        <RecordLink kind="person" id={row.personId}>{row.name}</RecordLink>: {row.dates.map(date).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              </Alert>
            ) : null}
            {preview.conflicts.shortfalls.length > 0 ? <Alert variant="warning">{t("request.shortfall", { dates: preview.conflicts.shortfalls.map((row) => date(row.date)).join(", "), min: preview.conflicts.shortfalls[0].minPresent })}</Alert> : null}
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <SubmitLeaveForm
          key={`${typeId}:${from}:${to}:${startPortion}:${endPortion}:${minutes}`}
          draft={{ personId: onBehalf ? personId : null, leaveTypeId: typeId, startDate: from, endDate: to, startPortion, endPortion, minutes }}
          amends={amended?.id ?? null}
          defaultReason={proposedReason}
          needsAttachment={preview.type.requiresAttachment}
          disabled={blocking.length > 0}
        />
      ) : null}
      <Link href="/leave" className="text-[0.8125rem] font-medium text-link">
        {t("back")}
      </Link>
    </Page>
  );
}
