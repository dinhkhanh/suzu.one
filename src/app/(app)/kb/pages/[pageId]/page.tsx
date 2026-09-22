import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { setPageAccessAction } from "@/modules/kb/actions";
import { parseSubjectKey } from "@/modules/kb/enums";
import { atLeast, breadcrumbOf, canManageSpace, spaceOwner, canOrganisePages, getAckSettings, getAckStatus, canPublishDirectly, getReadingView, kbViewerOf, levelOf, listPageAccess, listTree, loadPage, moveTargets, outlineOf, recordView, subjectNames, subjectOptions, syncReviewState } from "@/modules/kb/service";
import { AccessForm } from "@/modules/kb/ui/access-form";
import { AckSettingsForm, AcknowledgeButton } from "@/modules/kb/ui/ack-forms";
import { MovePageForm, PageLifecycleButtons, PageMetaForm, PublishDraftButton, SaveAsTemplateForm, SubmitReviewButton } from "@/modules/kb/ui/page-forms";
import { PageTree } from "@/modules/kb/ui/page-tree";
import { RenderDoc } from "@/modules/kb/ui/render-doc";
import { KbSearchBox } from "@/modules/kb/ui/search-box";

export const metadata: Metadata = { title: "Knowledge base" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KbPage(props: PageProps<"/kb/pages/[pageId]">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const query = await props.searchParams;
  const viewer = kbViewerOf(user);
  let loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
  // A review that was withdrawn through the generic approvals screen leaves the page to be released here.
  if (loaded && loaded.page.status === "in_review" && (await syncReviewState(loaded.page))) loaded = await loadPage(pageId);
  const level = loaded ? levelOf(viewer, loaded) : null;
  if (!loaded || !level) notFound();

  const { page, space } = loaded;
  const editor = atLeast(level, "edit");
  const organises = canOrganisePages(viewer, loaded.facts);
  const publishes = canPublishDirectly(viewer, loaded.facts, loaded.pageFacts);
  const manages = canManageSpace(user.principal, spaceOwner(space));
  const [t, tRoles, format, view, tree, ownRows, choices, ack, ackAudience] = await Promise.all([
    getTranslations("kb"),
    getTranslations("roles"),
    getFormatter(),
    getReadingView(loaded, level, query.draft === "1"),
    listTree(viewer, loaded),
    organises ? listPageAccess(page.id) : [],
    editor ? subjectOptions() : null,
    getAckStatus(page, user.person.id),
    manages ? getAckSettings(page.id) : [],
  ]);
  // The view count is not what the reader waits for: it is written once the page is sent.
  if (view.showing === "published") after(() => recordView(page.id, user.person.id, todayInVietnam()));

  const trail = breadcrumbOf(tree, page.id);
  const outline = outlineOf(view.content);
  const names = organises || manages ? await subjectNames([...(organises ? ownRows.map((row) => row.subjectKey) : []), ...(manages ? ackAudience : [])]) : new Map<string, string>();
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

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="order-2 flex flex-col gap-3 lg:order-1">
        <Link href={`/kb/spaces/${space.key}`} className="text-sm font-medium hover:underline">
          <span aria-hidden>{space.icon ?? "📄"}</span> {space.name}
        </Link>
        <KbSearchBox spaceId={space.id} compact />
        <PageTree tree={tree} currentId={page.id} compact />
      </aside>

      <article className="order-1 flex min-w-0 max-w-3xl flex-col gap-6 lg:order-2">
        <header className="flex flex-col gap-2">
          <nav aria-label={t("page.breadcrumb")} className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Link href="/kb" className="hover:underline">
              {t("title")}
            </Link>
            <span aria-hidden>/</span>
            <Link href={`/kb/spaces/${space.key}`} className="hover:underline">
              {space.name}
            </Link>
            {trail.map((node) => (
              <span key={node.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <Link href={`/kb/pages/${node.id}`} className="hover:underline">
                  {node.title}
                </Link>
              </span>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1>{view.title}</h1>
            {view.showing === "draft" ? <Badge variant="outline">{t("status.draft")}</Badge> : null}
            {page.status === "archived" || page.status === "in_review" ? <Badge variant="secondary">{t(`status.${page.status}`)}</Badge> : null}
            {page.accessRootId ? <Badge variant="outline">🔒 {t("page.restricted")}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {view.version ? t("page.versionLine", { n: view.version.versionNo, date: format.dateTime(view.version.createdAt, { dateStyle: "medium" }), name: view.version.authorName ?? "—" }) : t("page.neverPublished")}
            {page.reviewBy ? ` · ${t("page.reviewByLine", { date: format.dateTime(new Date(`${page.reviewBy}T00:00:00`), { dateStyle: "medium" }) })}` : ""}
          </p>
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
          </div>
        </header>

        {editor && page.publishedVersionId && page.hasUnpublishedChanges ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <span>{view.showing === "draft" ? t("page.showingDraft") : t("page.hasDraft")}</span>
            <Link href={view.showing === "draft" ? `/kb/pages/${page.id}` : `/kb/pages/${page.id}?draft=1`} className="underline underline-offset-2">
              {view.showing === "draft" ? t("page.viewPublished") : t("page.viewDraft")}
            </Link>
            {page.status === "in_review" ? null : publishes ? <PublishDraftButton pageId={page.id} /> : space.kind === "controlled" ? <SubmitReviewButton pageId={page.id} /> : null}
          </div>
        ) : null}
        {editor && !page.publishedVersionId && page.status !== "in_review" && (publishes || space.kind === "controlled") ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <span>{t("page.neverPublished")}</span>
            {publishes ? <PublishDraftButton pageId={page.id} /> : <SubmitReviewButton pageId={page.id} />}
          </div>
        ) : null}
        {editor && page.status === "in_review" && page.reviewRequestId ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <span>{t("review.waiting")}</span>
            <Link href={`/approvals/kb-publish/${page.reviewRequestId}`} className="underline underline-offset-2">
              {t("review.open")}
            </Link>
          </div>
        ) : null}

        {ack.inAudience && view.showing === "published" ? (
          ack.acknowledgedAt ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">{t("ack.done", { n: ack.versionNo ?? 0, date: format.dateTime(ack.acknowledgedAt, { dateStyle: "medium" }) })}</p>
          ) : (
            <div className={`flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm ${ack.overdue ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40" : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"}`}>
              <span>{ack.overdue ? t("ack.bannerOverdue", { date: format.dateTime(new Date(`${ack.dueOn}T00:00:00`), { dateStyle: "medium" }) }) : t("ack.banner", { date: format.dateTime(new Date(`${ack.dueOn}T00:00:00`), { dateStyle: "medium" }) })}</span>
            </div>
          )
        ) : null}
        {manages && page.ackRequired ? (
          <p className="text-sm">
            <Link href={`/kb/pages/${page.id}/acknowledgements`} className="underline underline-offset-2">
              {t("ack.reportLink")}
            </Link>
          </p>
        ) : null}

        {outline.length > 2 ? (
          <nav aria-label={t("page.contents")} className="rounded-md border p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("page.contents")}</p>
            <ul className="flex flex-col gap-0.5">
              {outline.map((item) => (
                <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.75}rem` }}>
                  <a href={`#${item.id}`} className="hover:underline">
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <RenderDoc doc={view.content} />

        {ack.inAudience && !ack.acknowledgedAt && view.showing === "published" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-4 text-sm">
            <span>{t("ack.confirmHelp")}</span>
            <AcknowledgeButton pageId={page.id} />
          </div>
        ) : null}

        {organises || editor ? (
          <details className="rounded-md border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("page.manage")}</summary>
            <div className="flex flex-col gap-6 pt-4">
              <PageMetaForm pageId={page.id} ownerPersonId={page.ownerPersonId} reviewBy={page.reviewBy} people={choices?.people ?? []} />
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
              <PageLifecycleButtons pageId={page.id} spaceKey={space.key} status={page.status} published={!!page.publishedVersionId} canPublish={publishes} canDelete={!hasChildren && (page.publishedVersionId ? publishes && organises : editor)} />
            </div>
          </details>
        ) : null}
      </article>
    </div>
  );
}
