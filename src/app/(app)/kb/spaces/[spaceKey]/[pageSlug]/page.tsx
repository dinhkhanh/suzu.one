import { ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { initialsOf } from "@/lib/text";
import { requireUser } from "@/modules/platform/auth/session";
import { setPageAccessAction } from "@/modules/kb/actions";
import { pagePath, parseSubjectKey } from "@/modules/kb/enums";
import {
  atLeast,
  breadcrumbOf,
  canManageSpace,
  spaceOwner,
  canOrganisePages,
  getAckSettings,
  getAckStatus,
  canPublishDirectly,
  getReadingView,
  kbViewerOf,
  levelOf,
  listPageAccess,
  listSpaces,
  listTree,
  loadPage,
  loadPageInSpace,
  loadSpace,
  moveTargets,
  outlineOf,
  recordView,
  subjectNames,
  subjectOptions,
  syncReviewState,
} from "@/modules/kb/service";
import { AccessForm } from "@/modules/kb/ui/access-form";
import { AckSettingsForm, AcknowledgeButton } from "@/modules/kb/ui/ack-forms";
import { appLinksOf } from "@/modules/kb/ui/app-links";
import { KbShell } from "@/modules/kb/ui/kb-shell";
import { MovePageForm, PageLifecycleButtons, PageMetaForm, PageSlugForm, PublishDraftButton, SaveAsTemplateForm, SubmitReviewButton } from "@/modules/kb/ui/page-forms";
import { PageDoc } from "@/modules/kb/ui/page-doc";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("knowledgeBase");

/** A page, read at its address in its space: /kb/spaces/<key>/<slug>. */
export default async function KbPage(props: PageProps<"/kb/spaces/[spaceKey]/[pageSlug]">) {
  const user = await requireUser();
  const { spaceKey, pageSlug } = await props.params;
  const query = await props.searchParams;
  const viewer = kbViewerOf(user);
  const inSpace = /^[a-z0-9-]{1,40}$/.test(spaceKey) ? await loadSpace({ key: spaceKey }) : null;
  let loaded = inSpace ? await loadPageInSpace(inSpace.space.id, pageSlug) : null;
  // A review that was withdrawn through the generic approvals screen leaves the page to be released here.
  if (loaded && loaded.page.status === "in_review" && (await syncReviewState(loaded.page))) loaded = await loadPage(loaded.page.id);
  const level = loaded ? levelOf(viewer, loaded) : null;
  if (!loaded || !level) notFound();
  // An old key, an old slug or the page's id: on to the address it has now.
  const here = pagePath(loaded.space.key, loaded.page);
  if (here !== `/kb/spaces/${spaceKey}/${pageSlug}`) redirect(query.draft === "1" ? `${here}?draft=1` : here);

  const { page, space } = loaded;
  const editor = atLeast(level, "edit");
  const organises = canOrganisePages(viewer, loaded.facts);
  const publishes = canPublishDirectly(viewer, loaded.facts, loaded.pageFacts);
  const manages = canManageSpace(user.principal, spaceOwner(space));
  // The company's people, units and entities to choose from: for whoever sets access or an
  // audience — the space's organisers and managers — and never a collaborator, who gets no
  // directory anywhere else either. A page-level editor chooses an owner from nobody new.
  const offersPeople = (organises || manages) && user.principal.workforceType !== "collaborator";
  const [t, tRoles, format, view, spaces, tree, ownRows, choices, ack, ackAudience] = await Promise.all([
    getTranslations("kb"),
    getTranslations("roles"),
    getFormatter(),
    getReadingView(loaded, level, query.draft === "1"),
    listSpaces(viewer),
    listTree(viewer, loaded),
    organises ? listPageAccess(page.id) : [],
    offersPeople ? subjectOptions() : null,
    getAckStatus(page, user.person.id),
    manages ? getAckSettings(page.id) : [],
  ]);
  // The view count is not what the reader waits for: it is written once the page is sent.
  if (view.showing === "published") after(() => recordView(page.id, user.person.id, todayInVietnam()));

  const trail = breadcrumbOf(tree, page.id);
  const outline = outlineOf(view.content);
  const appLinks = appLinksOf(view.content);
  // The owner's name is on the meta line for every reader; the directory already holds it when one was loaded.
  const ownerKey = !choices && page.ownerPersonId ? [`person:${page.ownerPersonId}`] : [];
  const names = organises || manages || ownerKey.length ? await subjectNames([...(organises ? ownRows.map((row) => row.subjectKey) : []), ...(manages ? ackAudience : []), ...ownerKey]) : new Map<string, string>();
  const ownerName = page.ownerPersonId ? (names.get(`person:${page.ownerPersonId}`) ?? choices?.people.find((person) => person.id === page.ownerPersonId)?.name ?? null) : null;
  // Without the directory, the owner field offers the owner the page already has, so a save keeps it.
  const ownerChoices = choices?.people ?? (page.ownerPersonId ? [{ id: page.ownerPersonId, name: ownerName ?? "—" }] : []);
  const accessRows = ownRows.map((row) => {
    const subject = parseSubjectKey(row.subjectKey);
    const name = subject?.type === "role" ? tRoles(subject.id as "owner") : (names.get(row.subjectKey) ?? "");
    return { ...row, label: !subject || subject.type === "all" ? t("access.subject.all") : `${t(`access.subject.${subject.type}`)}: ${name}` };
  });
  const audienceRows = ackAudience.map((key) => {
    const subject = parseSubjectKey(key);
    return { subjectKey: key, label: !subject || subject.type === "all" ? t("access.subject.all") : `${t(`access.subject.${subject.type}`)}: ${names.get(key) ?? ""}` };
  });
  const siblings = tree.filter((node) => node.parentId === (page.parentId ?? null) && node.id !== page.id);
  const hasChildren = tree.some((node) => node.parentId === page.id);
  const hasRail = outline.length > 2 || appLinks.length > 0;
  const mustAck = ack.inAudience && !ack.acknowledgedAt && view.showing === "published";

  return (
    <KbShell spaces={spaces} currentSpaceKey={space.key} tree={tree} currentPageId={page.id}>
      <div className={hasRail ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10" : undefined}>
        <article className="flex min-w-0 max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-3">
            <nav aria-label={t("page.breadcrumb")} className="flex flex-wrap items-center gap-1 text-[0.8125rem] text-muted-foreground">
              <Link href="/kb" className="hover:text-foreground hover:underline">
                {t("title")}
              </Link>
              <ChevronRightIcon aria-hidden className="size-3.5 text-faint" />
              <Link href={`/kb/spaces/${space.key}`} className="hover:text-foreground hover:underline">
                {space.name}
              </Link>
              {trail.map((node) => (
                <span key={node.id} className="flex items-center gap-1">
                  <ChevronRightIcon aria-hidden className="size-3.5 text-faint" />
                  <Link href={pagePath(space.key, node)} className="hover:text-foreground hover:underline">
                    {node.title}
                  </Link>
                </span>
              ))}
            </nav>
            <h1 className="text-[2.125rem] leading-[1.15]">{view.title}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span className="flex flex-wrap items-center gap-1.5">
                {view.showing === "draft" ? (
                  <Badge dot variant="outline">
                    {t("status.draft")}
                  </Badge>
                ) : (
                  <Badge dot variant={statusTone(page.status)}>
                    {t(`status.${page.status}`)}
                  </Badge>
                )}
                {page.ackRequired ? <Badge variant={mustAck ? (ack.overdue ? "destructive" : "warning") : "secondary"}>{t("ack.requiredBadge")}</Badge> : null}
                {page.accessRootId ? <Badge variant="outline">{t("page.restricted")}</Badge> : null}
              </span>
              {ownerName ? (
                <span className="flex items-center gap-1.5">
                  <Avatar size="sm">
                    <AvatarFallback>{initialsOf(ownerName)}</AvatarFallback>
                  </Avatar>
                  <RecordLink kind="person" id={page.ownerPersonId}>
                    {ownerName}
                  </RecordLink>
                </span>
              ) : null}
              {view.version ? (
                <span className="font-mono tabular-nums">
                  {t("page.versionShort", { n: view.version.versionNo })} · {format.dateTime(view.version.createdAt, { dateStyle: "medium" })}
                </span>
              ) : (
                <span>{t("page.neverPublished")}</span>
              )}
              {page.reviewBy ? <span className="font-mono tabular-nums">{t("page.reviewByLine", { date: format.dateTime(new Date(`${page.reviewBy}T00:00:00`), { dateStyle: "medium" }) })}</span> : null}
            </div>
            {editor || page.publishedVersionId ? (
              <div className="flex flex-wrap items-center gap-2">
                {editor ? (
                  <Link href={`/kb/pages/${page.id}/edit`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    {t("page.edit")}
                  </Link>
                ) : null}
                {page.publishedVersionId ? (
                  <Link href={`/kb/pages/${page.id}/history`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    {t("history.title")}
                  </Link>
                ) : null}
                {editor && !space.archivedAt ? (
                  <Link href={`/kb/spaces/${space.key}/new?parent=${page.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    {t("page.newChild")}
                  </Link>
                ) : null}
                {manages && page.ackRequired ? (
                  <Link href={`/kb/pages/${page.id}/acknowledgements`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    {t("ack.reportLink")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </header>

          {editor && page.publishedVersionId && page.hasUnpublishedChanges ? (
            <Alert variant="warning">
              <span>{view.showing === "draft" ? t("page.showingDraft") : t("page.hasDraft")}</span>
              <Link href={view.showing === "draft" ? here : `${here}?draft=1`} className="underline underline-offset-2">
                {view.showing === "draft" ? t("page.viewPublished") : t("page.viewDraft")}
              </Link>
              {page.status === "in_review" ? null : publishes ? <PublishDraftButton pageId={page.id} /> : space.kind === "controlled" ? <SubmitReviewButton pageId={page.id} /> : null}
            </Alert>
          ) : null}
          {editor && !page.publishedVersionId && page.status !== "in_review" && (publishes || space.kind === "controlled") ? (
            <Alert>
              <span>{t("page.neverPublished")}</span>
              {publishes ? <PublishDraftButton pageId={page.id} /> : <SubmitReviewButton pageId={page.id} />}
            </Alert>
          ) : null}
          {editor && page.status === "in_review" && page.reviewRequestId ? (
            <Alert variant="info">
              <span>{t("review.waiting")}</span>
              <Link href={`/approvals/kb-publish/${page.reviewRequestId}`}>{t("review.open")}</Link>
            </Alert>
          ) : null}

          {ack.inAudience && view.showing === "published" ? (
            ack.acknowledgedAt ? (
              <Alert variant="success">{t("ack.done", { n: ack.versionNo ?? 0, date: format.dateTime(ack.acknowledgedAt, { dateStyle: "medium" }) })}</Alert>
            ) : (
              <Alert variant={ack.overdue ? "destructive" : "info"} className="items-center">
                <span className="min-w-0 flex-1">
                  {ack.overdue
                    ? t("ack.bannerOverdue", { date: format.dateTime(new Date(`${ack.dueOn}T00:00:00`), { dateStyle: "medium" }) })
                    : t("ack.banner", { date: format.dateTime(new Date(`${ack.dueOn}T00:00:00`), { dateStyle: "medium" }) })}
                </span>
                <AcknowledgeButton pageId={page.id} />
              </Alert>
            )
          ) : null}

          {/* The phone's table of contents; the desk's is the rail at the right. */}
          {outline.length > 2 ? (
            <nav aria-label={t("page.contents")} className="rounded-[14px] border border-border bg-canvas px-4 py-3 text-sm xl:hidden">
              <p className="section-label mb-1.5">{t("page.contents")}</p>
              <ul className="flex flex-col gap-1">
                {outline.map((item) => (
                  <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.75}rem` }}>
                    <a href={`#${item.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <PageDoc doc={view.content} />

          {mustAck ? (
            <Alert className="items-center">
              <span className="min-w-0 flex-1">{t("ack.confirmHelp")}</span>
              <AcknowledgeButton pageId={page.id} />
            </Alert>
          ) : null}

          {organises || editor ? (
            <details className="group/manage rounded-[14px] border border-border bg-background">
              <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon aria-hidden className="size-4 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/manage:rotate-90" />
                {t("page.manage")}
              </summary>
              <div className="flex flex-col gap-6 border-t border-border p-4">
                <PageMetaForm pageId={page.id} ownerPersonId={page.ownerPersonId} reviewBy={page.reviewBy} people={ownerChoices} />
                {editor && !page.deletedAt ? <PageSlugForm pageId={page.id} spaceKey={space.key} slug={page.slug} title={page.publishedTitle ?? page.title} /> : null}
                {manages ? <SaveAsTemplateForm pageId={page.id} defaultName={page.title} /> : null}
                {manages && choices ? <AckSettingsForm pageId={page.id} required={page.ackRequired} dueDays={page.ackDueDays} audience={audienceRows} choices={choices} /> : null}
                {organises && choices ? (
                  <>
                    <MovePageForm pageId={page.id} parents={moveTargets(tree, page.id).map((node) => ({ id: node.id, title: node.title, depth: node.depth }))} parentId={page.parentId} siblingCount={siblings.length} />
                    <section className="flex flex-col gap-2">
                      <h2 className="text-sm font-medium">{t("access.pageTitle")}</h2>
                      <p className="text-xs text-muted-foreground">{page.accessRootId && page.accessRootId !== page.id ? t("access.inherited") : t("access.pageHelp")}</p>
                      <AccessForm target={{ pageId: page.id }} rows={accessRows} choices={choices} action={setPageAccessAction} />
                    </section>
                  </>
                ) : null}
                <PageLifecycleButtons
                  pageId={page.id}
                  spaceKey={space.key}
                  status={page.status}
                  published={!!page.publishedVersionId}
                  canPublish={publishes}
                  canDelete={!hasChildren && (page.publishedVersionId ? publishes && organises : editor)}
                />
              </div>
            </details>
          ) : null}
        </article>

        {hasRail ? (
          <aside className="hidden self-start xl:sticky xl:top-0 xl:block">
            <div className="flex flex-col gap-5 text-[0.8125rem]">
              {outline.length > 2 ? (
                <nav aria-label={t("page.contents")} className="flex flex-col gap-1.5">
                  <p className="section-label">{t("page.onThisPage")}</p>
                  <ul className="flex flex-col gap-1">
                    {outline.map((item) => (
                      <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.625}rem` }}>
                        <a href={`#${item.id}`} className="line-clamp-2 text-muted-foreground transition-colors hover:text-foreground">
                          {item.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}
              {appLinks.length > 0 ? (
                <nav aria-label={t("page.appLinks")} className="flex flex-col gap-1.5">
                  <p className="section-label">{t("page.appLinks")}</p>
                  <ul className="flex flex-col gap-1">
                    {appLinks.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="line-clamp-2 text-link hover:underline">
                          {link.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </KbShell>
  );
}
