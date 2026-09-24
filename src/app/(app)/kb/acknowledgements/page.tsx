import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { kbViewerOf, listMyAcknowledgements, listMyPendingAcks } from "@/modules/kb/service";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myAcknowledgements");

export default async function MyAcknowledgementsPage() {
  const user = await requireUser();
  const t = await getTranslations("kb");
  const format = await getFormatter();
  const [pending, done] = await Promise.all([listMyPendingAcks(kbViewerOf(user)), listMyAcknowledgements(user.person.id)]);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/kb" className="hover:underline">
            {t("title")}
          </Link>
        </p>
        <h1>{t("ack.mineTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("ack.mineHelp")}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("ack.pending", { count: pending.length })}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ack.nothingPending")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {pending.map((row) => (
              <li key={row.pageId} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Link href={`/kb/pages/${row.pageId}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {row.title}
                </Link>
                <span className="text-xs text-muted-foreground">{row.spaceName}</span>
                <Badge dot variant={row.overdue ? "destructive" : "outline"}>{row.overdue ? t("ack.overdueSince", { date: day(row.dueOn) }) : t("ack.dueOn", { date: day(row.dueOn) })}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("ack.doneTitle")}</h2>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ack.nothingDone")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("review.page")}</TableHead>
                <TableHead>{t("ack.version")}</TableHead>
                <TableHead>{t("ack.confirmedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {done.map((row) => (
                <TableRow key={`${row.pageId}-${row.versionNo}`}>
                  <TableCell>
                    <Link href={`/kb/pages/${row.pageId}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    v{row.versionNo} {row.current ? null : <span className="text-xs text-muted-foreground">· {t("ack.superseded")}</span>}
                  </TableCell>
                  <TableCell>{format.dateTime(row.acknowledgedAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
