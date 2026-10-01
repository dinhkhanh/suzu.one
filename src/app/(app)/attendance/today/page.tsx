import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { getWhoIsIn, type PresenceStatus } from "@/modules/attendance/punches";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("whoSInToday");

const ORDER: PresenceStatus[] = ["in", "off_site", "not_yet", "out", "on_leave", "untracked", "rest", "holiday", "unscheduled"];

// Who's in, out, not here yet or away (FR-ATT-15). A status for everyone the viewer may see; times
// only where the viewer may see the person's punches. Never a position.
export default async function WhoIsInPage(props: PageProps<"/attendance/today">) {
  const user = await requireUser();
  const [t, format] = await Promise.all([getTranslations("attendance.today"), getFormatter()]);
  const query = await props.searchParams;
  const departmentId = typeof query.department === "string" && query.department ? query.department : null;
  const presence = await getWhoIsIn({ personId: user.person.id, principal: user.principal }, { departmentId });
  const time = (value: Date | null) => (value ? format.dateTime(value, { hour: "2-digit", minute: "2-digit" }) : null);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${presence.date}T00:00:00`), { weekday: "long", day: "numeric", month: "long" })}</p>
      </header>

      <ul className="flex flex-wrap gap-2 text-sm">
        {ORDER.filter((status) => presence.counts[status] > 0).map((status) => (
          <li key={status}>
            <Badge dot variant={statusTone(status)}>
              {t(`status.${status}`)} · {presence.counts[status]}
            </Badge>
          </li>
        ))}
      </ul>

      {presence.departments.length > 1 ? (
        <nav className="tab-row">
          <Link href="/attendance/today" className={departmentId ? "underline-offset-4 hover:underline" : "font-medium"}>
            {t("everyone")}
          </Link>
          {presence.departments.map((department) => (
            <Link key={department.id} href={`/attendance/today?department=${department.id}`} className={department.id === departmentId ? "font-medium" : "underline-offset-4 hover:underline"}>
              {department.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("columns.person")}</TableHead>
            <TableHead kind="status">{t("columns.status")}</TableHead>
            <TableHead kind="time" className="text-left">{t("columns.times")}</TableHead>
            <TableHead kind="org">{t("columns.department")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {presence.rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell className="font-medium">
                {row.fullName}
                {row.isSelf ? <span className="font-normal text-muted-foreground"> · {t("you")}</span> : null}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <Badge dot variant={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge>
                  {row.partLeave ? <Badge variant="outline">{t("partLeave")}</Badge> : null}
                  {row.flagged ? <Badge variant="outline">{t("flagged")}</Badge> : null}
                </span>
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{[time(row.firstInAt), time(row.lastOutAt)].filter(Boolean).join(" → ")}</TableCell>
              <TableCell className="text-muted-foreground">{row.departmentName ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
