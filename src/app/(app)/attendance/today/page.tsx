import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getWhoIsIn, type PresenceStatus } from "@/modules/attendance/punches";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Who's in today" };

const ORDER: PresenceStatus[] = ["in", "off_site", "not_yet", "out", "on_leave", "untracked", "rest", "holiday", "unscheduled"];
const TONE: Partial<Record<PresenceStatus, "default" | "secondary" | "outline" | "destructive">> = { in: "default", off_site: "default", not_yet: "destructive", out: "secondary", on_leave: "secondary" };

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${presence.date}T00:00:00`), { weekday: "long", day: "numeric", month: "long" })}</p>
      </header>

      <ul className="flex flex-wrap gap-2 text-sm">
        {ORDER.filter((status) => presence.counts[status] > 0).map((status) => (
          <li key={status}>
            <Badge variant={TONE[status] ?? "outline"}>
              {t(`status.${status}`)} · {presence.counts[status]}
            </Badge>
          </li>
        ))}
      </ul>

      {presence.departments.length > 1 ? (
        <nav className="flex flex-wrap gap-3 text-sm">
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

      <ul className="flex flex-col divide-y rounded-xl border">
        {presence.rows.map((row) => (
          <li key={row.personId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
            <span className="min-w-40 font-medium">
              {row.fullName}
              {row.isSelf ? <span className="text-muted-foreground"> · {t("you")}</span> : null}
            </span>
            <Badge variant={TONE[row.status] ?? "outline"}>{t(`status.${row.status}`)}</Badge>
            {row.partLeave ? <Badge variant="outline">{t("partLeave")}</Badge> : null}
            {row.flagged ? <Badge variant="outline">{t("flagged")}</Badge> : null}
            <span className="text-muted-foreground">{[time(row.firstInAt), time(row.lastOutAt)].filter(Boolean).join(" → ")}</span>
            {row.departmentName ? <span className="ml-auto text-xs text-muted-foreground">{row.departmentName}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
