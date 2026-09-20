import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listRecentJobRuns } from "@/modules/platform/jobs/service";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Scheduled jobs" };

export default async function JobsPage() {
  const user = await requireUser();
  // System health is a group-level concern, same audience as the full audit log.
  if (!can(user.principal, "audit:read", {})) notFound();

  const [t, format] = await Promise.all([getTranslations("jobs"), getFormatter()]);
  const runs = await listRecentJobRuns(100);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("started")}</TableHead>
            <TableHead>{t("job")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>{t("took")}</TableHead>
            <TableHead>{t("result")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : null}
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap">{format.dateTime(run.startedAt, { dateStyle: "short", timeStyle: "medium" })}</TableCell>
              <TableCell className="font-mono text-xs">{run.job}</TableCell>
              <TableCell>
                <Badge variant={run.status === "failed" ? "destructive" : run.status === "running" ? "outline" : "secondary"}>{t(`statuses.${run.status}`)}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {run.finishedAt ? t("seconds", { seconds: Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 100) / 10) }) : "—"}
              </TableCell>
              <TableCell className="max-w-md font-mono text-xs break-words">{run.error ?? (run.result ? JSON.stringify(run.result) : "—")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
