// Page templates (FR-KB-09) and imports (FR-KB-10): both end in an ordinary draft page.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { type Doc, validateDoc } from "./engine/doc";
import { mammothHtmlToMarkdown } from "./engine/docx-html";
import { markdownToDoc } from "./engine/markdown";
import { type Actor, createPage, type PageRow } from "./pages";

export type TemplateRow = typeof schema.kbTemplate.$inferSelect;
export type TemplateOption = { id: string; key: string; name: string; description: string | null; isSystem: boolean; isActive: boolean };

export async function listTemplates(options: { includeInactive?: boolean } = {}): Promise<TemplateOption[]> {
  const rows = await db().select().from(schema.kbTemplate).orderBy(asc(schema.kbTemplate.sortOrder), asc(schema.kbTemplate.name));
  return rows.filter((row) => options.includeInactive || row.isActive).map((row) => ({ id: row.id, key: row.key, name: row.name, description: row.description, isSystem: row.isSystem, isActive: row.isActive }));
}

/** The document a new page starts from. An unknown or switched-off template is a refusal, not an empty page. */
export async function templateContent(templateId: string): Promise<Doc> {
  const [row] = await db().select().from(schema.kbTemplate).where(eq(schema.kbTemplate.id, templateId)).limit(1);
  if (!row || !row.isActive) throw new ActionError("kb_template_not_found");
  const checked = validateDoc(row.content);
  if (!checked.ok) throw new ActionError("kb_content_invalid");
  return checked.doc;
}

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/** A page's published (or working) content kept as a template for others to start from. */
export async function saveAsTemplate(input: { name: string; description: string | null; content: unknown }, actor: Actor): Promise<TemplateRow> {
  const checked = validateDoc(input.content);
  if (!checked.ok) throw new ActionError("kb_content_invalid");
  const base = slug(input.name) || "template";
  const taken = new Set((await db().select({ key: schema.kbTemplate.key }).from(schema.kbTemplate)).map((row) => row.key));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const [row] = await db().insert(schema.kbTemplate).values({ key, name: input.name.trim().slice(0, 120), description: input.description, content: checked.doc, isSystem: false, sortOrder: 1000, createdByPersonId: actor.personId }).returning();
  return row;
}

export async function setTemplateActive(templateId: string, isActive: boolean): Promise<{ before: TemplateRow; after: TemplateRow }> {
  const [before] = await db().select().from(schema.kbTemplate).where(eq(schema.kbTemplate.id, templateId)).limit(1);
  if (!before) throw new ActionError("kb_template_not_found");
  const [after] = await db().update(schema.kbTemplate).set({ isActive, updatedAt: new Date() }).where(eq(schema.kbTemplate.id, templateId)).returning();
  return { before, after };
}

export const MAX_IMPORT_CHARS = 400_000;

const titleFromFile = (fileName: string | null | undefined) => (fileName ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Markdown → a DRAFT page (FR-KB-10): pasted, uploaded as .md, or what Google Docs gives under
 * File → Download → Markdown. The title is the text's first level-1 heading, else the file's
 * name. Nothing is published: the editor reads the result first.
 */
export async function importMarkdownPage(input: { spaceId: string; parentId: string | null; markdown: string; title?: string | null; fileName?: string | null }, actor: Actor): Promise<{ page: PageRow; titleFrom: "given" | "heading" | "file" | "fallback" }> {
  if (!input.markdown.trim()) throw new ActionError("kb_import_empty");
  if (input.markdown.length > MAX_IMPORT_CHARS) throw new ActionError("kb_import_too_large");
  let imported;
  try {
    imported = markdownToDoc(input.markdown);
  } catch {
    throw new ActionError("kb_import_unreadable");
  }
  const given = input.title?.trim();
  const fromFile = titleFromFile(input.fileName);
  const title = given || imported.title || fromFile || "Trang nhập từ Markdown";
  const page = await createPage({ spaceId: input.spaceId, parentId: input.parentId, title, content: imported.doc }, actor);
  return { page, titleFrom: given ? "given" : imported.title ? "heading" : fromFile ? "file" : "fallback" };
}

/**
 * Word → HTML (mammoth, on the server) → Markdown (`mammothHtmlToMarkdown`, pure) → the same
 * importer. Nothing from the file reaches a page as markup; pictures inside it are left out.
 */
export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  // Loaded on demand: only the import screen pays for it.
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    return mammothHtmlToMarkdown(result.value);
  } catch {
    throw new ActionError("kb_import_unreadable");
  }
}
