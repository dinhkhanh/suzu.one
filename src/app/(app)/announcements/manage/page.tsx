import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { audienceNames, canPostAnywhere, listManagedAnnouncements } from "@/modules/comms/service";
import { audienceLabel } from "@/modules/comms/ui/labels";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Manage announcements" };

export default async function ManageAnnouncementsPage() {
  const user = await requireUser();
  if (!canPostAnywhere(user.principal)) notFound();
  const t = await getTranslations("comms");
  const format = await getFormatter();
  const rows = await listManagedAnnouncements(user.principal);
  const names = await audienceNames(rows.flatMap((row) => row.audience));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/announcements" className="hover:underline">
              {t("list.title")}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{t("manage.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("manage.help")}</p>
        </div>
        <Link href="/announcements/manage/new" className="text-sm underline underline-offset-2">
          {t("manage.new")}
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("manage.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("form.title")}</TableHead>
              <TableHead>{t("manage.phase")}</TableHead>
              <TableHead>{t("form.audience")}</TableHead>
              <TableHead>{t("form.publishAt")}</TableHead>
              <TableHead>{t("manage.author")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/announcements/manage/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  {row.pinned ? <Badge variant="secondary" className="ml-2">{t("list.pinned")}</Badge> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={row.phase === "live" ? "default" : "outline"}>{t(`phase.${row.phase}`)}</Badge>
                </TableCell>
                <TableCell className="max-w-64 truncate">{row.audience.map((key) => audienceLabel(key, names, t)).join(", ")}</TableCell>
                <TableCell>{row.publishAt ? format.dateTime(row.publishAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</TableCell>
                <TableCell>{row.authorName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
