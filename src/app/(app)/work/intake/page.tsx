import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { listMyIntakeRequests, listOpenIntakeForms, loadViewer } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requestWork");

// FR-WRK-16: the request forms this person may fill in, by team, and what became of their earlier requests.
export default async function IntakeIndexPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const [forms, mine] = await Promise.all([listOpenIntakeForms(viewer), listMyIntakeRequests(user.person.id)]);
  const t = await getTranslations("work.intake");
  const tWork = await getTranslations("work");
  const format = await getFormatter();

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {tWork("title")}
          </Link>
        }
        title={t("title")}
        description={t("indexDescription")}
      />

      {forms.length === 0 ? (
        <List>
          <ListEmpty>{t("noneOpen")}</ListEmpty>
        </List>
      ) : null}
      {[...Map.groupBy(forms, (form) => form.teamName)].map(([teamName, own]) => (
        <TableCard key={teamName}>
          <TableCardHeader title={teamName} count={own.length} />
          <List>
            {own.map((form) => (
              <ListItem key={form.id}>
                <div className="min-w-0 flex-1">
                  <Link href={`/work/intake/${form.id}`} className="font-medium hover:underline">
                    {form.name}
                  </Link>
                  {form.description?.trim() ? <p className="line-clamp-2 text-xs text-muted-foreground">{noteToPlainText(form.description)}</p> : null}
                </div>
              </ListItem>
            ))}
          </List>
        </TableCard>
      ))}

      {mine.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("myRequests")} count={mine.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{tWork("table.key")}</TableHead>
                <TableHead kind="text">{tWork("table.title")}</TableHead>
                <TableHead kind="select">{tWork("triage.rules.form")}</TableHead>
                <TableHead kind="date">{t("sentOn")}</TableHead>
                <TableHead kind="status">{tWork("task.fields.state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((request) => (
                <TableRow key={request.taskId}>
                  <TableCell kind="id">{request.key}</TableCell>
                  <TableCell className="max-w-80">
                    <RecordLink kind="task" id={request.taskId} className="block truncate font-medium">
                      {request.title}
                    </RecordLink>
                  </TableCell>
                  <TableCell>{request.formName ?? "—"}</TableCell>
                  <TableCell>{format.dateTime(request.createdAt, { dateStyle: "medium" })}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.stateName}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </Page>
  );
}
