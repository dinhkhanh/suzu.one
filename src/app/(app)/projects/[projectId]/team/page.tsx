import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { type BookingView, capacityOfBooked, isMonday, listProjectBookings, loadCapacityReader, mondayOf, openProject, weeksFrom } from "@/modules/projects/service";
import { BookForm, BookingEditor, FillPlaceholderForm } from "@/modules/projects/ui/booking-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectTeam");

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
  const totals = weeks.map((week) =>
    bookings
      .filter((booking) => booking.weekStart === week.start)
      .reduce((sum, booking) => ({ confirmed: sum.confirmed + (booking.status === "confirmed" ? booking.minutes : 0), tentative: sum.tentative + (booking.status === "tentative" ? booking.minutes : 0) }), { confirmed: 0, tentative: 0 }),
  );
  const nav = (start: string) => `/projects/${project.id}/team?from=${start}`;

  return (
    <Page width="wide">
      <ProjectHeader context={context} current="team" />

      <TableCard>
        <TableCardHeader
          title={t("title")}
          description={t("description")}
          actions={
            <nav className="flex flex-wrap items-center gap-2">
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={nav(addDays(from, -7 * WEEKS))} />}>
                {t("earlier")}
              </Button>
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={nav(mondayOf(today))} />}>
                {t("thisWeek")}
              </Button>
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={nav(addDays(from, 7 * WEEKS))} />}>
                {t("later")}
              </Button>
              {reader.mayOpen ? (
                <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/projects/capacity" />}>
                  {t("capacityLink")}
                </Button>
              ) : null}
            </nav>
          }
        />

        <Table numbered={false} className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead kind="person" className="sticky left-0 z-10 w-40 min-w-36 bg-canvas">
                {t("who")}
              </TableHead>
              {weeks.map((week) => (
                <TableHead key={week.start} kind="number" className={week.start === mondayOf(today) ? "text-foreground" : ""}>
                  {weekLabel(week.start)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {lines.map(([key, own]) => {
              const personId = own[0].personId;
              const row = personId ? capacity.get(personId) : undefined;
              const role = personId ? own.find((booking) => booking.placeholderRole)?.placeholderRole : undefined;
              return (
                <TableRow key={key}>
                  <TableCell className="sticky left-0 z-10 h-auto max-w-40 bg-background whitespace-normal">
                    {personId ? (
                      <RecordLink kind="person" id={personId} className="block font-medium">
                        {own[0].personName}
                      </RecordLink>
                    ) : (
                      <span className="block font-medium italic">{t("placeholder", { role: own[0].placeholderRole ?? "" })}</span>
                    )}
                    {role ? <span className="block text-xs text-muted-foreground">{role}</span> : null}
                  </TableCell>
                  {weeks.map((week, index) => {
                    const cell = own.filter((booking) => booking.weekStart === week.start);
                    const capacityCell = row?.cells[index];
                    const tentative = cell.every((booking) => booking.status === "tentative");
                    return (
                      <TableCell key={week.start} kind="number" className="h-auto p-1">
                        <div
                          className={`flex min-h-11 flex-col items-end justify-center rounded-md px-2 py-1 font-sans ${capacityCell?.over ? "bg-destructive/10" : cell.length === 0 ? "text-muted-foreground" : tentative ? "border border-dashed border-border" : "bg-muted"}`}
                        >
                          <p className="font-mono font-medium">
                            {cell.length ? t("hoursShort", { hours: hours(cell.reduce((sum, booking) => sum + booking.minutes, 0)) }) : "—"}
                            {cell.length && tentative ? <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">{t("statuses.tentative")}</span> : null}
                          </p>
                          {capacityCell ? (
                            <p className="text-xs text-muted-foreground">
                              {t("free", { free: hours(capacityCell.freeMinutes), available: hours(capacityCell.availableMinutes) })}
                              {capacityCell.awayDays > 0 ? ` · ${t("away", { days: capacityCell.awayDays })}` : ""}
                            </p>
                          ) : null}
                          {capacityCell?.over ? <p className="text-xs font-medium text-destructive">{t("over")}</p> : null}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {lines.length ? (
              <TableRow className="text-xs text-muted-foreground">
                <TableCell className="sticky left-0 z-10 bg-background font-medium">{t("total")}</TableCell>
                {totals.map((total, index) => (
                  <TableCell key={weeks[index].start} kind="number" className="h-auto py-2">
                    {t("hoursShort", { hours: hours(total.confirmed) })}
                    {total.tentative ? <span className="block font-sans">+ {t("tentativeHours", { hours: hours(total.tentative) })}</span> : null}
                  </TableCell>
                ))}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t("legend")}</p>
        {can.editPlan ? (
          <TableAddRow label={t("add")} open={lines.length === 0}>
            <BookForm projectId={project.id} people={people} weeks={bookingWeeks} />
          </TableAddRow>
        ) : null}
      </TableCard>

      {can.editPlan ? (
        <>
          {openRoles.length ? (
            <TableCard>
              <TableCardHeader title={t("openRoles")} count={openRoles.length} description={t("fillHint")} />
              <List>
                {openRoles.map((role) => (
                  <ListItem key={role} className="block">
                    <FillPlaceholderForm projectId={project.id} role={role} people={people} />
                  </ListItem>
                ))}
              </List>
            </TableCard>
          ) : null}

          {lines.length ? (
            <TableCard>
              <TableCardHeader title={t("edit")} count={lines.length} />
              <List>
                {lines.map(([key, own]) => (
                  <ListItem key={key} className="block">
                    <details>
                      <summary className="cursor-pointer font-medium">
                        {own[0].personId ? own[0].personName : t("placeholder", { role: own[0].placeholderRole ?? "" })} <Badge variant="secondary">{t("weeksCount", { count: own.length })}</Badge>
                      </summary>
                      <div className="flex flex-col gap-2 pt-3">
                        {own.map((booking) => (
                          <BookingEditor key={booking.id} booking={{ id: booking.id, minutes: booking.minutes, status: booking.status, note: booking.note, weekLabel: weekLabel(booking.weekStart) }} />
                        ))}
                      </div>
                    </details>
                  </ListItem>
                ))}
              </List>
            </TableCard>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
