import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { todayInVietnam } from "@/lib/dates";
import { getTeamCalendar } from "@/modules/leave/calendar";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Team leave calendar" };

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

// Who is away when (FR-LVE-05). Colleagues see that someone is away; managers and HR also see why.
export default async function TeamCalendarPage(props: PageProps<"/leave/calendar">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const t = await getTranslations("leave");
  const format = await getFormatter();
  const asked = Array.isArray(query.month) ? query.month[0] : query.month;
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : todayInVietnam().slice(0, 7);
  const department = Array.isArray(query.department) ? query.department[0] : query.department;
  const departmentId = department && UUID.test(department) ? department : null;
  const range = monthRange(month);
  const calendar = await getTeamCalendar({ personId: user.person.id, principal: user.principal }, { from: range.from, to: range.to, departmentId });
  const link = (value: string, dept: string | null) => `/leave/calendar?month=${value}${dept ? `&department=${dept}` : ""}`;
  const off = (kind: string) => kind !== "working";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("calendar.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("calendar.description")}</p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={link(range.previous, departmentId)} className="underline-offset-4 hover:underline">
            ←
          </Link>
          <span className="font-medium">{format.dateTime(new Date(`${range.from}T00:00:00`), { month: "long", year: "numeric" })}</span>
          <Link href={link(range.next, departmentId)} className="underline-offset-4 hover:underline">
            →
          </Link>
        </nav>
      </header>
      {calendar.departments.length > 1 ? (
        <nav className="tab-row">
          <Link href={link(month, null)} className={departmentId ? "text-muted-foreground hover:underline" : "font-semibold"}>
            {t("calendar.everyone")}
          </Link>
          {calendar.departments.map((row) => (
            <Link key={row.id} href={link(month, row.id)} className={departmentId === row.id ? "font-semibold" : "text-muted-foreground hover:underline"}>
              {row.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 bg-background p-2 text-left font-medium">{t("calendar.person")}</th>
              {calendar.dates.map((day) => (
                <th key={day.date} className={`w-8 min-w-8 p-1 text-center font-normal ${off(day.kind) ? "bg-muted text-muted-foreground" : ""} ${day.date === todayInVietnam() ? "font-semibold underline" : ""}`}>
                  {Number(day.date.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calendar.people.map((person) => (
              <tr key={person.personId} className="border-t">
                <td className="sticky left-0 z-10 bg-background p-2">
                  <span className={person.isSelf ? "font-medium" : ""}>{person.fullName}</span>
                </td>
                {calendar.dates.map((day) => {
                  const cell = person.cells.find((candidate) => candidate.date === day.date);
                  const label = cell ? `${cell.typeName ?? t("calendar.away")}${cell.portion === "full" ? "" : ` · ${t(`portions.${cell.portion}`)}`}${cell.status === "pending" ? ` · ${t("status.pending")}` : ""}` : undefined;
                  return (
                    <td key={day.date} title={label} className={`p-0.5 text-center ${off(day.kind) ? "bg-muted" : ""}`}>
                      {cell ? <span aria-label={label} className={`mx-auto block h-5 rounded ${cell.portion === "full" ? "w-6" : "w-3"} ${cell.status === "pending" ? "border border-dashed border-primary" : "bg-primary"}`} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="block h-3 w-4 rounded bg-primary" /> {t("status.approved")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="block h-3 w-4 rounded border border-dashed border-primary" /> {t("status.pending")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="block h-3 w-4 rounded bg-muted" /> {t("calendar.nonWorking")}
        </li>
      </ul>
      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm font-medium text-muted-foreground">{t("calendar.list")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {calendar.people
            .filter((person) => person.cells.length > 0)
            .map((person) => (
              <li key={person.personId} className="p-3">
                <span className="font-medium">{person.fullName}</span>{" "}
                <span className="text-muted-foreground">
                  {[...person.cells]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((cell) => `${Number(cell.date.slice(8))}${cell.portion === "full" ? "" : "½"}`)
                    .join(", ")}
                  {person.cells[0].typeName ? ` · ${[...new Set(person.cells.map((cell) => cell.typeName))].join(", ")}` : ""}
                </span>
              </li>
            ))}
        </ul>
      </section>
      <Link href="/leave" className="text-sm underline-offset-4 hover:underline">
        {t("back")}
      </Link>
    </div>
  );
}
