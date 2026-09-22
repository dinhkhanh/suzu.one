import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { type BookingView, capacityOfBooked, isMonday, listProjectBookings, loadCapacityReader, mondayOf, openProject, weeksFrom } from "@/modules/projects/service";
import { BookForm, BookingEditor, FillPlaceholderForm } from "@/modules/projects/ui/booking-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";

export const metadata: Metadata = { title: "Project team" };

const WEEKS = 8;
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/**
 * Who is booked on the project, week by week (FR-PJM-13): people and placeholder roles, confirmed
 * and tentative hours. Every reader of the project sees the bookings; whoever runs it books. A
 * person's availability is shown beside their bookings only to someone who may see their capacity.
 */
export default async function ProjectTeamPage({ params, searchParams }: PageProps<"/projects/[projectId]/team">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, can } = context;
  const query = await searchParams;
  const today = todayInVietnam();
  const from = typeof query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.from) && isMonday(query.from) ? query.from : mondayOf(today);
  const weeks = weeksFrom(from, WEEKS);
  const [t, format, bookings, reader] = await Promise.all([getTranslations("projects.bookings"), getFormatter(), listProjectBookings(project.id, weeks[0].start, weeks.at(-1)!.start), loadCapacityReader(user)]);
  const personIds = [...new Set(bookings.flatMap((booking) => (booking.personId ? [booking.personId] : [])))];
  const [capacity, people] = await Promise.all([capacityOfBooked(user, personIds, weeks), can.editPlan ? listPersonNames() : Promise.resolve([])]);

  const day = (date: string) => format.dateTime(new Date(`${date}T00:00:00`), { day: "numeric", month: "numeric" });
  const weekLabel = (start: string) => t("weekOf", { date: day(start) });
  // One line per person, then one per open placeholder role.
  const lineKey = (booking: BookingView) => (booking.personId ? `p:${booking.personId}` : `r:${booking.placeholderRole}`);
  const lines = [...Map.groupBy(bookings, lineKey).entries()].sort(([a], [b]) => (a[0] === b[0] ? 0 : a[0] === "p" ? -1 : 1));
  const openRoles = [...new Set(bookings.filter((booking) => !booking.personId && booking.placeholderRole).map((booking) => booking.placeholderRole!))];
  const bookingWeeks = Array.from({ length: 26 }, (_, index) => addDays(mondayOf(today), index * 7)).map((start) => ({ start, label: t("weekOf", { date: day(start) }) }));
  const totals = weeks.map((week) => bookings.filter((booking) => booking.weekStart === week.start).reduce((sum, booking) => ({ confirmed: sum.confirmed + (booking.status === "confirmed" ? booking.minutes : 0), tentative: sum.tentative + (booking.status === "tentative" ? booking.minutes : 0) }), { confirmed: 0, tentative: 0 }));
  const nav = (start: string) => `/projects/${project.id}/team?from=${start}`;

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="max-w-5xl">
        <ProjectHeader context={context} current="team" />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{t("title")}</h2>
          <nav className="flex items-center gap-3 text-sm">
            <Link href={nav(addDays(from, -7 * WEEKS))} className="underline">
              {t("earlier")}
            </Link>
            <Link href={nav(mondayOf(today))} className="underline">
              {t("thisWeek")}
            </Link>
            <Link href={nav(addDays(from, 7 * WEEKS))} className="underline">
              {t("later")}
            </Link>
            {reader.mayOpen ? (
              <Link href="/projects/capacity" className="underline">
                {t("capacityLink")}
              </Link>
            ) : null}
          </nav>
        </div>
        <p className="text-sm text-muted-foreground">{t("description")}</p>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-1 text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="w-48 px-2 font-medium">{t("who")}</th>
                  {weeks.map((week) => (
                    <th key={week.start} className={`px-2 font-medium ${week.start === mondayOf(today) ? "text-foreground" : ""}`}>
                      {weekLabel(week.start)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(([key, own]) => {
                  const personId = own[0].personId;
                  const row = personId ? capacity.get(personId) : undefined;
                  return (
                    <tr key={key}>
                      <th scope="row" className="px-2 text-left align-top font-medium">
                        {personId ? own[0].personName : <span className="italic">{t("placeholder", { role: own[0].placeholderRole ?? "" })}</span>}
                        {personId && own.some((booking) => booking.placeholderRole) ? <span className="block text-xs font-normal text-muted-foreground">{own.find((booking) => booking.placeholderRole)?.placeholderRole}</span> : null}
                      </th>
                      {weeks.map((week, index) => {
                        const cell = own.filter((booking) => booking.weekStart === week.start);
                        const capacityCell = row?.cells[index];
                        const tentative = cell.every((booking) => booking.status === "tentative");
                        return (
                          <td key={week.start} className={`rounded-lg border p-2 align-top ${cell.length === 0 ? "text-muted-foreground" : tentative ? "border-dashed" : ""} ${capacityCell?.over ? "border-destructive/50 bg-destructive/5" : ""}`}>
                            {cell.length ? (
                              <p className="font-medium tabular-nums">
                                {t("hoursShort", { hours: hours(cell.reduce((sum, booking) => sum + booking.minutes, 0)) })}
                                {tentative ? <span className="ml-1 text-xs font-normal text-muted-foreground">{t("statuses.tentative")}</span> : null}
                              </p>
                            ) : (
                              "—"
                            )}
                            {capacityCell ? (
                              <p className="text-xs text-muted-foreground">
                                {t("free", { free: hours(capacityCell.freeMinutes), available: hours(capacityCell.availableMinutes) })}
                                {capacityCell.awayDays > 0 ? ` · ${t("away", { days: capacityCell.awayDays })}` : ""}
                              </p>
                            ) : null}
                            {capacityCell?.over ? <p className="text-xs font-medium text-destructive">{t("over")}</p> : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="text-xs text-muted-foreground">
                  <th scope="row" className="px-2 text-left font-medium">
                    {t("total")}
                  </th>
                  {totals.map((total, index) => (
                    <td key={weeks[index].start} className="px-2 tabular-nums">
                      {t("hoursShort", { hours: hours(total.confirmed) })}
                      {total.tentative ? ` + ${t("tentativeHours", { hours: hours(total.tentative) })}` : ""}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("legend")}</p>
      </section>

      {can.editPlan ? (
        <>
          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h2 className="text-base font-medium">{t("add")}</h2>
            <BookForm projectId={project.id} people={people} weeks={bookingWeeks} />
          </section>

          {openRoles.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-medium">{t("openRoles")}</h2>
              <p className="text-sm text-muted-foreground">{t("fillHint")}</p>
              {openRoles.map((role) => (
                <FillPlaceholderForm key={role} projectId={project.id} role={role} people={people} />
              ))}
            </section>
          ) : null}

          {lines.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-medium">{t("edit")}</h2>
              {lines.map(([key, own]) => (
                <details key={key} className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {own[0].personId ? own[0].personName : t("placeholder", { role: own[0].placeholderRole ?? "" })} <Badge variant="secondary">{t("weeksCount", { count: own.length })}</Badge>
                  </summary>
                  <div className="flex flex-col gap-2 pt-3">
                    {own.map((booking) => (
                      <BookingEditor key={booking.id} booking={{ id: booking.id, minutes: booking.minutes, status: booking.status, note: booking.note, weekLabel: weekLabel(booking.weekStart) }} />
                    ))}
                  </div>
                </details>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
