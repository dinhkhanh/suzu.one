import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { canRequestDigitalAccess, getDigitalAssetView } from "@/modules/assets/service";
import { AccessRequestActions, CredentialsRotatedButton, EndAccessButton, GrantAccessForm, RequestAccessForm } from "@/modules/assets/ui/digital-forms";
import { PlatformBadge } from "@/modules/assets/ui/digital-views";
import { listWorkOfDigitalAsset, loadViewer } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("digitalAsset");

// One digital asset (FR-AST-07, 08): what it is, who answers for it, who can get in — and the work
// aimed at it (FR-AST-09), which the work module narrows to what this reader may already open.
export default async function DigitalAssetPage({ params }: PageProps<"/assets/digital/[digitalAssetId]">) {
  const user = await requireUser();
  const { digitalAssetId } = await params;
  const view = /^[0-9a-f-]{36}$/.test(digitalAssetId) ? await getDigitalAssetView(user.principal, digitalAssetId) : null;
  // Not there, or none of this reader's business — the same answer either way.
  if (!view) notFound();
  const { asset, secrets, canRun } = view;

  const [t, format, people, work] = await Promise.all([getTranslations("assets.digital"), getFormatter(), canRun ? listPersonNames() : [], loadViewer(user).then((viewer) => listWorkOfDigitalAsset(viewer, asset.id))]);
  const today = todayInVietnam();
  const day = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }) : "—");
  const moment = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "—");
  const isoDay = (value: string | null) => (value ? value.split("-").reverse().join("/") : "—");
  const me = user.person.id;
  const mayAsk = !asset.mine && !canRun && asset.status !== "retired" && canRequestDigitalAccess(user.principal, { entityId: asset.entityId, ownerPersonId: asset.ownerPersonId, visibility: asset.visibility });

  const fact = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div>
        <dt className="tile-label">{label}</dt>
        <dd className="text-sm">{value}</dd>
      </div>
    );

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/assets/digital" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={asset.name}
        actions={
          canRun ? (
            <Button nativeButton={false} variant="outline" render={<Link href={`/assets/digital/${asset.id}/edit`} />}>
              {t("edit")}
            </Button>
          ) : null
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <PlatformBadge platform={asset.platform} />
          <span>{t(`kind.${asset.kind}`)}</span>
          {asset.handle ? <span className="font-mono text-[0.8125rem]">{asset.handle}</span> : null}
          <Badge dot variant={statusTone(asset.status)}>
            {t(`status.${asset.status}`)}
          </Badge>
          {asset.visibility === "restricted" ? <Badge variant="outline">{t("visibility.restricted")}</Badge> : null}
        </p>
      </PageHeader>

      {/* Somebody who knew the shared password is out, and it has not been changed since. */}
      {secrets?.rotationDueSince ? (
        <Alert variant="destructive" className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("rotation.due", { date: day(secrets.rotationDueSince) })}</span>
          <CredentialsRotatedButton assetId={asset.id} />
        </Alert>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 rounded-[14px] border border-border bg-background p-4 sm:grid-cols-3">
        {fact(t("fields.owner"), asset.ownerName ?? <span className="text-warning">{t("noOwner")}</span>)}
        {fact(t("fields.entity"), asset.entityName)}
        {fact(asset.ownership === "client" ? t("fields.client") : t("fields.brand"), asset.clientName)}
        {fact(t("fields.ownership"), t(`ownership.${asset.ownership}`))}
        {fact(
          t("fields.url"),
          asset.url ? (
            <a href={asset.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-link underline-offset-2 hover:underline">
              {asset.url}
            </a>
          ) : null,
        )}
      </dl>

      {/* Restricted: only for whoever runs the asset. Where the login is kept — never the login. */}
      {secrets ? (
        <Section title={t("secrets.title")} description={t("secrets.readers")}>
          <dl className="grid grid-cols-1 gap-4 rounded-[14px] border border-border bg-background p-4 sm:grid-cols-2">
            {fact(t("secrets.loginIdentity"), secrets.loginIdentity ?? "—")}
            {fact(t("secrets.recoveryContact"), secrets.recoveryContact ?? "—")}
            {fact(t("secrets.credentialLocation"), secrets.credentialLocation ?? "—")}
            {fact(t("rotation.last"), secrets.credentialsRotatedAt ? day(secrets.credentialsRotatedAt) : "—")}
            {secrets.notes ? (
              <div className="sm:col-span-2">
                <dt className="tile-label">{t("fields.notes")}</dt>
                <dd>
                  <RichText text={secrets.notes} className="text-sm" />
                </dd>
              </div>
            ) : null}
          </dl>
        </Section>
      ) : null}

      {/* The reader's own standing, when they are neither in nor running it. */}
      {asset.mine?.status === "requested" ? (
        <Alert variant="warning" className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("request.waiting", { owner: asset.ownerName ?? t("request.keepers") })}</span>
          {view.requests.filter((row) => row.personId === me).map((row) => (
            <EndAccessButton key={row.id} accessId={row.id} label={t("request.withdraw")} confirm={t("request.withdraw")} />
          ))}
        </Alert>
      ) : null}
      {mayAsk ? (
        <Section title={t("request.title")} description={t("request.intro", { owner: asset.ownerName ?? t("request.keepers") })}>
          <RequestAccessForm assetId={asset.id} />
        </Section>
      ) : null}

      {canRun && view.requests.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("decide.title")} count={view.requests.length} />
          <List>
            {view.requests.map((row) => (
              <ListItem key={row.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{row.personName}</span>
                  <Badge variant="warning">{t(`level.${row.level}`)}</Badge>
                  <span className="text-xs text-faint">{moment(row.requestedAt)}</span>
                </div>
                {row.note ? <p className="text-sm text-muted-foreground">{row.note}</p> : null}
                <AccessRequestActions accessId={row.id} level={row.level} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("access.title")} count={view.access.length || null} description={t("access.description")} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("access.person")}</TableHead>
              <TableHead kind="select">{t("access.level")}</TableHead>
              {canRun ? <TableHead kind="select" className="hidden md:table-cell">{t("access.method")}</TableHead> : null}
              <TableHead kind="date" className="hidden md:table-cell">{t("access.since")}</TableHead>
              <TableHead kind="date" className="hidden md:table-cell">{t("access.until")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.access.length === 0 ? <TableEmpty>{t("access.empty")}</TableEmpty> : null}
            {view.access.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{row.personName}</span>
                  {row.note ? <p className="text-xs text-faint">{row.note}</p> : null}
                  {/* On a phone the columns to the right fold into this line. */}
                  <p className="text-xs text-faint md:hidden">
                    {[canRun && row.method ? t(`method.${row.method}`) : null, day(row.grantedAt), row.expiresOn ? `→ ${isoDay(row.expiresOn)}` : null].filter(Boolean).join(" · ")}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant={row.level === "admin" ? "violet" : "secondary"}>{t(`level.${row.level}`)}</Badge>
                </TableCell>
                {canRun ? <TableCell className="hidden md:table-cell">{row.method ? <span className={row.method === "shared_login" ? "text-warning" : undefined}>{t(`method.${row.method}`)}</span> : "—"}</TableCell> : null}
                <TableCell kind="date" className="hidden md:table-cell">{day(row.grantedAt)}</TableCell>
                {/* A day that has passed is one to look at again: the grant does not end by itself. */}
                <TableCell kind="date" className={`hidden md:table-cell ${row.expiresOn && row.expiresOn < today ? "font-medium text-destructive" : ""}`}>
                  {isoDay(row.expiresOn)}
                </TableCell>
                <TableCell kind="actions">
                  {canRun ? <EndAccessButton accessId={row.id} label={t("end.revoke")} confirm={t("end.confirmRevoke")} /> : row.personId === me ? <EndAccessButton accessId={row.id} label={t("end.giveUp")} confirm={t("end.confirmGiveUp")} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canRun && asset.status !== "retired" ? (
          <TableAddRow label={t("grant.title")}>
            <GrantAccessForm assetId={asset.id} people={people} />
          </TableAddRow>
        ) : null}
      </TableCard>

      {/* FR-AST-09: the work aimed at this asset, as far as this reader may open it. */}
      <TableCard>
        <TableCardHeader title={t("work.tasks")} count={work.tasks.length || null} description={work.projects.length ? t("work.projects", { names: work.projects.map((project) => project.name).join(", ") }) : undefined} />
        <List>
          {work.tasks.length === 0 ? <ListEmpty>{t("work.noTasks")}</ListEmpty> : null}
          {work.tasks.map((task) => (
            <ListItem key={task.id} href={`/work/tasks/${task.id}`} className="flex-col items-start gap-0.5 md:flex-row md:items-center md:gap-3">
              <span className="flex w-full min-w-0 items-baseline gap-2 md:flex-1">
                <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
                <span className="min-w-0 truncate font-medium">{task.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">{[task.stateName, task.assigneeName, task.dueDate ? isoDay(task.dueDate) : null].filter(Boolean).join(" · ")}</span>
            </ListItem>
          ))}
        </List>
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("work.posts")} count={work.posts.length || null} />
        <List>
          {work.posts.length === 0 ? <ListEmpty>{t("work.noPosts")}</ListEmpty> : null}
          {work.posts.map((post) => (
            <ListItem key={post.id} href={`/work/tasks/${post.taskId}`} className="flex-col items-start gap-1 md:flex-row md:items-center md:gap-3">
              <span className="flex w-full min-w-0 items-baseline gap-2 md:flex-1">
                <span className="font-mono text-xs text-muted-foreground">{post.key}</span>
                <span className="min-w-0 truncate">{post.title}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge dot variant={statusTone(post.status)}>
                  {t(`work.post.${post.status === "published" ? "published" : "planned"}`)}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{moment(post.publishedAt ?? post.plannedAt)}</span>
              </span>
            </ListItem>
          ))}
        </List>
      </TableCard>

      {canRun && view.history.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("history.title")} count={view.history.length} />
          <List>
            {view.history.map((row) => (
              <ListItem key={row.id} className="flex-wrap gap-x-3 gap-y-0.5">
                <Badge variant={statusTone(row.status)}>{t(`access.status.${row.status}`)}</Badge>
                <span className="font-medium">{row.personName}</span>
                <span className="text-xs text-muted-foreground">
                  {[t(`level.${row.level}`), row.grantedAt ? `${day(row.grantedAt)} → ${day(row.endedAt)}` : day(row.endedAt), row.endedByName, row.endNote].filter(Boolean).join(" · ")}
                </span>
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}
    </Page>
  );
}
