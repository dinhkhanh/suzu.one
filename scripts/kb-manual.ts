// The user manual (docs/manual/*.md) as a knowledge-base space, through the app's own page services:
// each file is a page, made and published the way the editor would, so search, the assistant's
// passages and the history behave as for any other page.
//
//   pnpm kb:manual --author <work email>          against the database in .env.local
//   pnpm kb:manual --check                        only reads the files and prints the tree
//
// `NN-slug.md` is a chapter at the top of the space; `NN-MM-slug.md` sits under chapter NN. The
// first `# heading` of a file is the page title. Idempotent: a page is found again by its title
// (or the address its title gives), and a new version is published only when its text changed, so
// re-running after editing the Markdown publishes just the edited pages. A page whose file was
// removed is left as it is and listed at the end. The embeddings follow with the next embedding job.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { pageSlugOf } from "../src/modules/kb/enums";
import { createPage, movePage, publishPage, saveDraft } from "../src/modules/kb/pages";
import { createSpace } from "../src/modules/kb/spaces";
import { markdownToDoc } from "../src/modules/platform/rich-text/engine/markdown";

config({ path: ".env.local" });
// A variable left blank in the file is one not set: the integrations this script never touches need not be configured.
for (const [name, value] of Object.entries(process.env)) if (value === "") delete process.env[name];

const SPACE = {
  key: "huong-dan",
  name: "Hướng dẫn sử dụng SuZu One",
  icon: "📖",
  description: "Cách dùng từng phần của SuZu One: chấm công, nghỉ phép, công việc, lương, tri thức và các màn hình quản trị.",
};
const DIR = path.join(process.cwd(), "docs/manual");
/** A page renamed in its file is found again by the title it had, and takes the new one. */
const FORMER_TITLES: Record<string, string[]> = {
  "Hỏi SuZu AI & báo cáo": ["Hỏi SuZu & báo cáo"],
  "Hỏi SuZu AI": ["Hỏi SuZu"],
  "Nhờ SuZu AI làm giúp": ["Nhờ SuZu làm giúp"],
  "Hỏi SuZu AI về số liệu của bạn": ["Hỏi SuZu về số liệu của bạn"],
};
const FILE = /^(\d{2})(?:-(\d{2}))?-[a-z0-9-]+\.md$/;

type ManualPage = { file: string; chapter: string; child: boolean; title: string; content: ReturnType<typeof markdownToDoc>["doc"] };

function readManual(): ManualPage[] {
  // A chapter first, then its pages: "04-nhan-su" before "04-01-…".
  const files = readdirSync(DIR)
    .filter((file) => FILE.test(file))
    .map((file) => ({ file, match: FILE.exec(file)! }))
    .sort((a, b) => `${a.match[1]}-${a.match[2] ?? ""}`.localeCompare(`${b.match[1]}-${b.match[2] ?? ""}`));
  return files.map(({ file, match: [, chapter, sub] }) => {
    const { title, doc } = markdownToDoc(readFileSync(path.join(DIR, file), "utf8"));
    if (!title) throw new Error(`${file}: the file must open with a "# Title" line`);
    return { file, chapter, child: !!sub, title, content: doc };
  });
}

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const manual = readManual();
  const chapters = new Set(manual.filter((page) => !page.child).map((page) => page.chapter));
  for (const page of manual) if (page.child && !chapters.has(page.chapter)) throw new Error(`${page.file}: there is no chapter ${page.chapter}`);
  if (process.argv.includes("--check")) {
    for (const page of manual) console.log(`${page.child ? "    " : ""}${page.title}  (${page.file})`);
    console.log(`${manual.length} pages read; nothing written`);
    return;
  }

  const email = argument("author")?.toLowerCase();
  if (!email) throw new Error("usage: pnpm kb:manual --author <work email of the person publishing>   (or --check to only read the files)");
  const [author] = await db().select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.workEmail, email)).limit(1);
  if (!author) throw new Error(`nobody has the work email ${email}`);
  const actor = { personId: author.id };

  // Everybody reads it; HR keeps it. A controlled space: other editors' changes go through review.
  let [space] = await db().select().from(schema.kbSpace).where(eq(schema.kbSpace.key, SPACE.key)).limit(1);
  if (!space) {
    space = await createSpace({ ...SPACE, entityId: null, kind: "controlled", sortOrder: 0 }, author.id, [
      { subjectKey: "all", level: "view" },
      { subjectKey: "role:hr_admin", level: "edit" },
      { subjectKey: "role:hr_staff", level: "edit" },
    ]);
    console.log(`space "${space.name}" created (/kb/spaces/${space.key})`);
  }

  const existing = await db()
    .select({
      id: schema.kbPage.id,
      title: schema.kbPage.title,
      slug: schema.kbPage.slug,
      parentId: schema.kbPage.parentId,
      status: schema.kbPage.status,
      content: schema.kbPage.content,
      publishedVersionId: schema.kbPage.publishedVersionId,
      hasUnpublishedChanges: schema.kbPage.hasUnpublishedChanges,
    })
    .from(schema.kbPage)
    .where(and(eq(schema.kbPage.spaceId, space.id), isNull(schema.kbPage.deletedAt)));
  const claimed = new Set<string>();
  const find = (title: string) => existing.find((row) => !claimed.has(row.id) && [title, ...(FORMER_TITLES[title] ?? [])].some((name) => row.title === name || row.slug === pageSlugOf(name)));

  const chapterIds = new Map<string, string>();
  const positions = new Map<string | null, number>();
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const page of manual) {
    const parentId = page.child ? chapterIds.get(page.chapter)! : null;
    const position = positions.get(parentId) ?? 0;
    positions.set(parentId, position + 1);

    const found = find(page.title);
    let id: string;
    if (!found) {
      const row = await createPage({ spaceId: space.id, parentId, title: page.title, content: page.content }, actor);
      await publishPage(row.id, actor, { changeNote: "Bản đầu tiên" });
      id = row.id;
      counts.created++;
      console.log(`+ ${page.file}  ${page.title}`);
    } else {
      id = found.id;
      claimed.add(id);
      if (found.status === "in_review") {
        counts.skipped++;
        console.log(`! ${page.file}  ${page.title}: a revision is waiting for review, left alone`);
      } else {
        const { after } = await saveDraft(id, { title: page.title, content: page.content }, actor);
        if (found.publishedVersionId && !found.hasUnpublishedChanges && JSON.stringify(after.content) === JSON.stringify(found.content) && after.title === found.title) {
          // Same text: take back the "unpublished changes" flag the save just raised.
          await db().update(schema.kbPage).set({ hasUnpublishedChanges: false }).where(eq(schema.kbPage.id, id));
          counts.unchanged++;
        } else {
          await publishPage(id, actor, { changeNote: "Cập nhật hướng dẫn" });
          counts.updated++;
          console.log(`~ ${page.file}  ${page.title}`);
        }
      }
    }
    // Keep the tree in the files' order.
    await movePage(id, { parentId, position });
    if (!page.child) chapterIds.set(page.chapter, id);
  }

  const left = existing.filter((row) => !claimed.has(row.id));
  for (const row of left) console.log(`? no file for "${row.title}" — left as it is`);
  console.log(`${manual.length} pages: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.skipped} in review`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
