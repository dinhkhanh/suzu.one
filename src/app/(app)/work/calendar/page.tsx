import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { todayInVietnam } from "@/lib/dates";
import { getDaysOff } from "@/modules/attendance/service";
import { requireUser } from "@/modules/platform/auth/session";
import { isMonthKey, monthGrid } from "@/modules/work/engine/calendar";
import { FILTER_KEYS, type TaskFilters } from "@/modules/work/engine/filter";
import { contentCalendar, listCalendarTasks, listClients, listLabels, listTeams, loadViewer, canViewTeam, teamFacts } from "@/modules/work/service";
import { CalendarView } from "@/modules/work/ui/calendar-view";

export const metadata: Metadata = { title: "Content calendar" };

// Every dated task the viewer may see, across projects: filtered by client or channel it is the
// content calendar of a brand (FR-WRK-05).
export default async function WorkCalendarPage({ searchParams }: PageProps<"/work/calendar">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("work");
  const viewer = await loadViewer(user);
  const today = todayInVietnam();
  const month = isMonthKey(query.month) ? query.month : today.slice(0, 7);
  const grid = monthGrid(month);

  const [tasks, teams, clients, daysOff] = await Promise.all([listCalendarTasks(viewer, grid), listTeams(), listClients({ activeOnly: true }), getDaysOff(user.person.primaryEntityId, grid.from, grid.to)]);
  // FR-PJM-54: the posts of the publish log over the tasks — planned against published, late and missing flagged.
  const content = await contentCalendar(viewer, grid, tasks);
  const ownTeams = teams.filter((team) => team.isActive && canViewTeam(viewer, teamFacts(team)) && (tasks.some((task) => task.teamId === team.id) || content.posts.some((post) => post.teamId === team.id)));
  const labels = await listLabels(ownTeams.map((team) => team.id));
  // People to filter by: whoever holds a task on this calendar.
  const people = [...new Map(tasks.flatMap((task) => (task.assigneePersonId && task.assigneeName ? [[task.assigneePersonId, { id: task.assigneePersonId, fullName: task.assigneeName }] as const] : []))).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const filters: TaskFilters = Object.fromEntries(FILTER_KEYS.flatMap((key) => (typeof query[key] === "string" ? [[key, query[key]]] : [])));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
        </p>
        <h1>{t("calendar.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("calendar.description")}</p>
      </header>
      <CalendarView
        tasks={tasks}
        options={{ states: [], people, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })) }}
        month={month}
        daysOff={daysOff.map(({ date, name }) => ({ date, name }))}
        teams={ownTeams.map(({ id, name }) => ({ id, name }))}
        initialFilters={filters}
        initialExtra={{ team: typeof query.team === "string" ? query.team : undefined, channel: typeof query.channel === "string" ? query.channel : undefined }}
        selfId={user.person.id}
        today={today}
        posts={content.posts}
        missingTaskIds={content.missingTaskIds}
      />
    </div>
  );
}
