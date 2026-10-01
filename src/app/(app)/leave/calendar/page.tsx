import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { type CalendarCell, getTeamCalendar } from "@/modules/leave/calendar";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("teamLeaveCalendar");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pad = (value: number) => String(value).padStart(2, "0");

function monthRange(month: string) {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const shift = (by: number) => {
    const moved = new Date(Date.UTC(year, index - 1 + by, 1));
    return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`;
  };
  return { from: `${month}-01`, to: `${month}-${pad(last)}`, previous: shift(-1), next: shift(1) };
}

/** What a cell is, for its tint: waiting, remote work, part of a day, or a plain approved day. */
type CellKind = "pending" | "remote" | "half" | "approved";
const kindOf = (cell: CalendarCell): CellKind => (cell.status === "pending" ? "pending" : /wfh|remote/i.test(cell.typeCode ?? "") ? "remote" : cell.portion !== "full" ? "half" : "approved");
const TINT: Record<CellKind, string> = { approved: "bg-primary", pending: "bg-primary/20", remote: "bg-tone-teal/15", half: "bg-warning/15" };
const DOT: Record<CellKind, string> = { approved: "bg-primary", pending: "bg-primary/30", remote: "bg-tone-teal/40", half: "bg-warning/40" };

// Who is away when (FR-LVE-05). Colleagues see that someone is away; managers and HR also see why.
export default async function TeamCalendarPage(props: PageProps<"/leave/calendar">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const t = await getTranslations("leave");
  const format = await getFormatter();
  const today = todayInVietnam();
  const asked = Array.isArray(query.month) ? query.month[0] : query.month;
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const department = Array.isArray(query.department) ? query.department[0] : query.department;
  const departmentId = department && UUID.test(department) ? department : null;
  const range = monthRange(month);
  const calendar = await getTeamCalendar({ personId: user.person.id, principal: user.principal }, { from: range.from, to: range.to, departmentId });
  const link = (value: string, dept: string | null) => `/leave/calendar?month=${value}${dept ? `&department=${dept}` : ""}`;
  const off = (kind: string) => kind !== "working";
  const awayPeople = calendar.people.filter((person) => person.cells.length > 0);
  const hasRemote = calendar.people.some((person) => person.cells.some((cell) => kindOf(cell) === "remote"));
  const legend: CellKind[] = ["approved", "pending", "half", ...(hasRemote ? (["remote"] as const) : [])];

  return (
    <Page width="wide">
      <PageHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <nav className="flex items-center gap-2">
            <Link href={link(range.previous, departmentId)} className={cn(buttonVariants({ variant: "outline", size: "icon" }))} aria-label={t("calendar.previous")}>
              <ChevronLeftIcon />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{format.dateTime(new Date(`${range.from}T00:00:00`), { month: "long", year: "numeric" })}</span>
            <Link href={link(range.next, departmentId)} className={cn(buttonVariants({ variant: "outline", size: "icon" }))} aria-label={t("calendar.next")}>
              <ChevronRightIcon />
            </Link>
          </nav>
        }
      />

      {calendar.departments.length > 1 ? (
        <nav className="tab-row">
          <Link href={link(month, null)} aria-current={departmentId ? undefined : "page"}>
            {t("calendar.everyone")}
          </Link>
          {calendar.departments.map((row) => (
            <Link key={row.id} href={link(month, row.id)} aria-current={departmentId === row.id ? "page" : undefined}>
              {row.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <Section>
        <Table numbered={false} className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead kind="person" className="sticky left-0 z-10 min-w-36 bg-canvas">
                {t("calendar.person")}
              </TableHead>
              {calendar.dates.map((day) => (
                <TableHead key={day.date} className={cn("h-auto w-7 min-w-7 px-0.5 py-2 text-center font-mono tabular-nums", off(day.kind) && "text-faint", day.date === today && "text-primary")}>
                  {Number(day.date.slice(8))}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {calendar.people.length === 0 ? <TableEmpty>{t("calendar.noneAway")}</TableEmpty> : null}
            {calendar.people.map((person) => {
              const byDate = new Map(person.cells.map((cell) => [cell.date, cell]));
              return (
                <TableRow key={person.personId}>
                  <TableCell className="sticky left-0 z-10 h-9 bg-background py-1 text-[0.8125rem]">
                    <span className={cn("block max-w-44 truncate", person.isSelf && "font-medium")}>{person.fullName}</span>
                  </TableCell>
                  {calendar.dates.map((day) => {
                    const cell = byDate.get(day.date);
                    const label = cell ? `${cell.typeName ?? t("calendar.away")}${cell.portion === "full" ? "" : ` · ${t(`portions.${cell.portion}`)}`}${cell.status === "pending" ? ` · ${t("status.pending")}` : ""}` : undefined;
                    return (
                      <TableCell key={day.date} title={label} className={cn("h-9 p-0.5 text-center", off(day.kind) && "bg-canvas")}>
                        {cell ? <span aria-label={label} role="img" className={cn("mx-auto block h-5 w-full rounded-[4px]", TINT[kindOf(cell)])} /> : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-0.5 text-xs text-muted-foreground">
          {legend.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", DOT[kind])} />
              {kind === "approved" ? t("status.approved") : kind === "pending" ? t("status.pending") : kind === "half" ? t("calendar.half") : t("calendar.remote")}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full border border-border bg-canvas" />
            {t("calendar.nonWorking")}
          </li>
        </ul>
      </Section>

      <Section title={t("calendar.list")} count={awayPeople.length || null}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("calendar.person")}</TableHead>
                <TableHead kind="date">{t("request.dates")}</TableHead>
                <TableHead kind="select">{t("request.type")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {awayPeople.length === 0 ? <TableEmpty>{t("calendar.noneAway")}</TableEmpty> : null}
              {awayPeople.map((person) => (
                <TableRow key={person.personId}>
                  <TableCell className="font-medium">{person.fullName}</TableCell>
                  <TableCell className="whitespace-normal">
                    {[...person.cells]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((cell) => `${Number(cell.date.slice(8))}${cell.portion === "full" ? "" : "½"}`)
                      .join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{person.cells[0].typeName ? [...new Set(person.cells.map((cell) => cell.typeName))].join(", ") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
      <Link href="/leave" className="text-[0.8125rem] font-medium text-link">
        {t("back")}
      </Link>
    </Page>
  );
}
