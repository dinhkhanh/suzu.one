import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { getWhoIsIn, type PresenceStatus } from "@/modules/attendance/punches";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

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
  const times = (row: (typeof presence.rows)[number]) => [time(row.firstInAt), time(row.lastOutAt)].filter(Boolean).join(" → ");

  return (
    <Page>
      <PageHeader eyebrow={format.dateTime(new Date(`${presence.date}T00:00:00`), { weekday: "long", day: "numeric", month: "long" })} title={t("title")} />

      <ul className="flex flex-wrap gap-2 text-sm">
        {ORDER.filter((status) => presence.counts[status] > 0).map((status) => (
          <li key={status}>
            <Badge dot variant={statusTone(status)}>
              {t(`status.${status}`)} <span className="font-mono tabular-nums">{presence.counts[status]}</span>
            </Badge>
          </li>
        ))}
      </ul>

      {presence.departments.length > 1 ? (
        <nav className="tab-row">
          <Link href="/attendance/today" aria-current={departmentId ? undefined : "page"}>
            {t("everyone")}
          </Link>
          {presence.departments.map((department) => (
            <Link key={department.id} href={`/attendance/today?department=${department.id}`} aria-current={department.id === departmentId ? "page" : undefined}>
              {department.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <Section count={presence.rows.length || null}>
        <List className="md:hidden">
          {presence.rows.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {presence.rows.map((row) => (
            <ListItem key={row.personId}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">
                  <RecordLink kind="person" id={row.personId}>
                    {row.fullName}
                  </RecordLink>
                  {row.isSelf ? <span className="font-normal text-muted-foreground"> · {t("you")}</span> : null}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge dot variant={statusTone(row.status)}>
                    {t(`status.${row.status}`)}
                  </Badge>
                  {row.partLeave ? <Badge variant="outline">{t("partLeave")}</Badge> : null}
                  {row.flagged ? <Badge variant="outline">{t("flagged")}</Badge> : null}
                </span>
              </span>
              <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{times(row)}</span>
            </ListItem>
          ))}
        </List>
        <TableCard className="hidden md:flex">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("columns.person")}</TableHead>
                <TableHead kind="status">{t("columns.status")}</TableHead>
                <TableHead kind="time" className="text-left">
                  {t("columns.times")}
                </TableHead>
                <TableHead kind="org">{t("columns.department")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presence.rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
              {presence.rows.map((row) => (
                <TableRow key={row.personId}>
                  <TableCell className="font-medium">
                    <RecordLink kind="person" id={row.personId}>
                      {row.fullName}
                    </RecordLink>
                    {row.isSelf ? <span className="font-normal text-muted-foreground"> · {t("you")}</span> : null}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Badge dot variant={statusTone(row.status)}>
                        {t(`status.${row.status}`)}
                      </Badge>
                      {row.partLeave ? <Badge variant="outline">{t("partLeave")}</Badge> : null}
                      {row.flagged ? <Badge variant="outline">{t("flagged")}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-left font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{times(row)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <RecordLink kind="unit" id={row.departmentId}>
                      {row.departmentName}
                    </RecordLink>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
    </Page>
  );
}
