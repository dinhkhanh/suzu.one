import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { atLeast, compareVersions, kbViewerOf, levelOf, listVersions, loadPage } from "@/modules/kb/service";
import { RestoreVersionButton } from "@/modules/kb/ui/page-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("pageHistory");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const versionNumber = (value: unknown) => (typeof value === "string" && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null);

export default async function KbPageHistory(props: PageProps<"/kb/pages/[pageId]/history">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const query = await props.searchParams;
  const viewer = kbViewerOf(user);
  const loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
  const level = loaded ? levelOf(viewer, loaded) : null;
  // History is what was published: a reader of the page may read it.
  if (!loaded || !level || (!atLeast(level, "edit") && !loaded.pageFacts.readable)) notFound();

  const t = await getTranslations("kb");
  const format = await getFormatter();
  const editor = atLeast(level, "edit");
  const versions = await listVersions(loaded.page);
  const from = versionNumber(query.from);
  // "draft" compares with the working copy, which only editors may see.
  const to = query.to === "draft" ? (editor ? null : undefined) : (versionNumber(query.to) ?? undefined);
  const comparison = from !== null && to !== undefined ? await compareVersions(loaded.page, from, to) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/kb/pages/${loaded.page.id}`} className="hover:underline">
            {loaded.page.publishedTitle ?? loaded.page.title}
          </Link>
        </p>
        <h1>{t("history.title")}</h1>
      </header>

      <ul className="flex flex-col divide-y rounded-md border">
        {versions.map((version, index) => {
          const previous = versions[index + 1];
          return (
            <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className="font-medium">v{version.versionNo}</span>
              {version.current ? <Badge variant="secondary">{t("history.current")}</Badge> : null}
              {version.isMajor ? <Badge variant="outline">{t("history.major")}</Badge> : null}
              <span className="min-w-0 flex-1 truncate">{version.changeNote ?? version.title}</span>
              <span className="text-xs text-muted-foreground">
                {version.authorName ?? "—"} · {format.dateTime(version.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              {previous ? (
                <Link href={`/kb/pages/${loaded.page.id}/history?from=${previous.versionNo}&to=${version.versionNo}`} className="text-xs underline underline-offset-2">
                  {t("history.compareWithPrevious")}
                </Link>
              ) : null}
              {editor && loaded.page.hasUnpublishedChanges && version.current ? (
                <Link href={`/kb/pages/${loaded.page.id}/history?from=${version.versionNo}&to=draft`} className="text-xs underline underline-offset-2">
                  {t("history.compareWithDraft")}
                </Link>
              ) : null}
              {editor && !version.current ? <RestoreVersionButton pageId={loaded.page.id} versionNo={version.versionNo} /> : null}
            </li>
          );
        })}
      </ul>

      {comparison ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("history.comparing", { from: `v${comparison.from.versionNo}`, to: comparison.to.versionNo === null ? t("status.draft") : `v${comparison.to.versionNo}` })}</h2>
          {comparison.from.title !== comparison.to.title ? (
            <p className="text-sm">
              <span className="bg-red-100 line-through dark:bg-red-950/60">{comparison.from.title}</span> → <span className="bg-emerald-100 dark:bg-emerald-950/60">{comparison.to.title}</span>
            </p>
          ) : null}
          {comparison.lines.every((line) => line.type === "same") ? <p className="text-sm text-muted-foreground">{t("history.noChanges")}</p> : null}
          <div className="overflow-x-auto rounded-md border font-mono text-xs">
            {comparison.lines.map((line, index) => (
              <div key={index} className={`flex gap-2 px-3 py-0.5 whitespace-pre-wrap ${line.type === "added" ? "bg-emerald-100 dark:bg-emerald-950/60" : line.type === "removed" ? "bg-red-100 dark:bg-red-950/60" : ""}`}>
                <span aria-hidden className="w-3 shrink-0 select-none text-muted-foreground">
                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : ""}
                </span>
                <span className="min-w-0 break-words">{line.text}</span>
              </div>
            ))}
          </div>
        </section>
      ) : from !== null ? (
        <p className="text-sm text-muted-foreground">{t("history.notFound")}</p>
      ) : null}
    </div>
  );
}
