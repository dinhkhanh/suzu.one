import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listRecentJobRuns } from "@/modules/platform/jobs/service";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("scheduledJobs");

export default async function JobsPage() {
  const user = await requireUser();
  // System health is a group-level concern, same audience as the full audit log.
  if (!can(user.principal, "audit:read", {})) notFound();

  const [t, format, runs] = await Promise.all([getTranslations("jobs"), getFormatter(), listRecentJobRuns(100)]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="date">{t("started")}</TableHead>
            <TableHead kind="id">{t("job")}</TableHead>
            <TableHead kind="status">{t("status")}</TableHead>
            <TableHead kind="time">{t("took")}</TableHead>
            <TableHead kind="text">{t("result")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{format.dateTime(run.startedAt, { dateStyle: "short", timeStyle: "medium" })}</TableCell>
              <TableCell kind="id">{run.job}</TableCell>
              <TableCell>
                <Badge dot variant={statusTone(run.status)}>{t(`statuses.${run.status}`)}</Badge>
              </TableCell>
              <TableCell kind="time" className="text-muted-foreground">
                {run.finishedAt ? t("seconds", { seconds: Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 100) / 10) }) : "—"}
              </TableCell>
              <TableCell className="max-w-md font-mono text-xs break-words whitespace-normal">{run.error ?? (run.result ? JSON.stringify(run.result) : "—")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
