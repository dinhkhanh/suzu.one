// The reading view of a document — a knowledge-base page or a note: React elements built from the
// stored JSON, node by node. No HTML string is ever produced or injected — a node the renderer does
// not know is dropped, and every address goes through the same allow-list the validator used (a
// second time, on purpose).
import { cn } from "cn";
import { CheckSquare2, Square } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { type CalloutKind, CALLOUT_KINDS } from "../engine/callouts";
import { type Doc, type DocMark, type DocNode, headingId, TEXT_ALIGNS } from "../engine/doc";
import { isInternalHref, normalizeEmbed, safeHref } from "../engine/embed";

/** How a document's uploaded files are reached: their address, and the link that opens one. */
export type DocFiles = {
  href: (fileId: string) => string;
  Link: ComponentType<{ fileId: string; fileName?: string; className?: string; children: ReactNode }>;
};

const CALLOUT_STYLE: Record<CalloutKind, string> = {
  info: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
  warning: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  success: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
  danger: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40",
};
const CALLOUT_ICON: Record<CalloutKind, string> = { info: "ℹ️", warning: "⚠️", success: "✅", danger: "⛔" };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function withMarks(children: ReactNode, marks: readonly DocMark[] | undefined, key: string): ReactNode {
  let node = children;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
    else if (mark.type === "strike") node = <s>{node}</s>;
    else if (mark.type === "underline") node = <u>{node}</u>;
    else if (mark.type === "highlight") node = <mark className="rounded-sm bg-warning/30 px-0.5 text-inherit">{node}</mark>;
    else if (mark.type === "code") node = <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node}</code>;
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (href)
        node = isInternalHref(href) ? (
          <a href={href} className="text-primary underline underline-offset-2">
            {node}
          </a>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
            {node}
          </a>
        );
    }
  }
  return <span key={key}>{node}</span>;
}

type Context = { headings: number; files?: DocFiles };

const ALIGN_CLASS: Record<string, string> = { center: "text-center", right: "text-right", justify: "text-justify" };
const alignOf = (node: DocNode): string | undefined => ((TEXT_ALIGNS as readonly unknown[]).includes(node.attrs?.textAlign) ? ALIGN_CLASS[node.attrs!.textAlign as string] : undefined);

function renderNode(node: DocNode, key: string, context: Context): ReactNode {
  const children = () => (node.content ?? []).map((child, index) => renderNode(child, `${key}.${index}`, context));
  switch (node.type) {
    case "text":
      return withMarks(node.text ?? "", node.marks, key);
    case "hardBreak":
      return <br key={key} />;
    case "mention":
      return (
        <a key={key} href={`/people/${String(node.attrs?.personId ?? "")}`} className="rounded bg-muted px-1 text-primary">
          @{String(node.attrs?.label ?? "")}
        </a>
      );
    case "paragraph":
      return (
        <p key={key} className={cn("leading-[1.7]", alignOf(node))}>
          {children()}
        </p>
      );
    case "heading": {
      const id = headingId(context.headings++);
      const level = Number(node.attrs?.level ?? 1);
      const align = alignOf(node);
      if (level === 1)
        return (
          <h2 key={key} id={id} className={cn("mt-[0.5em] scroll-mt-20 text-[1.35em] font-semibold tracking-tight", align)}>
            {children()}
          </h2>
        );
      if (level === 2)
        return (
          <h3 key={key} id={id} className={cn("mt-[0.4em] scroll-mt-20 text-[1.18em] font-semibold", align)}>
            {children()}
          </h3>
        );
      return (
        <h4 key={key} id={id} className={cn("mt-[0.25em] scroll-mt-20 text-[1.05em] font-semibold", align)}>
          {children()}
        </h4>
      );
    }
    case "bulletList":
      return (
        <ul key={key} className="ml-6 list-disc space-y-1">
          {children()}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={typeof node.attrs?.start === "number" ? node.attrs.start : undefined} className="ml-6 list-decimal space-y-1">
          {children()}
        </ol>
      );
    case "listItem":
      return (
        <li key={key} className="space-y-1">
          {children()}
        </li>
      );
    case "taskList":
      return (
        <ul key={key} className="space-y-1">
          {children()}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      const Box = checked ? CheckSquare2 : Square;
      return (
        <li key={key} className="flex items-start gap-2">
          <Box aria-hidden className={cn("mt-[0.3em] size-[1.05em] shrink-0", checked ? "text-success" : "text-muted-foreground")} />
          <span className="sr-only">{checked ? "☑" : "☐"}</span>
          <div className={cn("min-w-0 flex-1 space-y-1", checked && "text-muted-foreground line-through")}>{children()}</div>
        </li>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="space-y-2 border-l-4 pl-4 text-muted-foreground">
          {children()}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.9em]">
          <code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.92em]">
            <tbody>{children()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children()}</tr>;
    case "tableHeader":
    case "tableCell": {
      const span = { colSpan: typeof node.attrs?.colspan === "number" ? node.attrs.colspan : undefined, rowSpan: typeof node.attrs?.rowspan === "number" ? node.attrs.rowspan : undefined };
      return node.type === "tableHeader" ? (
        <th key={key} {...span} className="space-y-1 border bg-muted/60 px-3 py-2 text-left align-top font-medium">
          {children()}
        </th>
      ) : (
        <td key={key} {...span} className="space-y-1 border px-3 py-2 align-top">
          {children()}
        </td>
      );
    }
    case "callout": {
      const kind = (CALLOUT_KINDS as readonly unknown[]).includes(node.attrs?.kind) ? (node.attrs!.kind as CalloutKind) : "info";
      return (
        <aside key={key} className={`flex gap-3 rounded-md border p-3 ${CALLOUT_STYLE[kind]}`}>
          <span aria-hidden>{CALLOUT_ICON[kind]}</span>
          <div className="min-w-0 flex-1 space-y-2">{children()}</div>
        </aside>
      );
    }
    case "embed": {
      const embed = normalizeEmbed(node.attrs?.url);
      if (!embed) return null;
      return (
        <div key={key} className="aspect-video w-full overflow-hidden rounded-md border bg-muted">
          <iframe src={embed.src} title={embed.provider} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allowFullScreen className="size-full" />
        </div>
      );
    }
    case "image": {
      const files = context.files;
      const uploaded = typeof node.attrs?.fileId === "string" ? node.attrs.fileId : null;
      const src = uploaded ? (files ? files.href(uploaded) : null) : typeof node.attrs?.src === "string" && /^https:\/\//i.test(node.attrs.src) ? safeHref(node.attrs.src) : null;
      if (!src) return null;
      // eslint-disable-next-line @next/next/no-img-element -- private files behind a signed redirect: the image optimiser cannot fetch them
      const image = <img src={src} alt={String(node.attrs?.alt ?? "")} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-md border" />;
      // An uploaded picture opens larger in the preview dialog; an outside one is only shown.
      return uploaded && files ? (
        <files.Link key={key} fileId={uploaded} className="block w-fit max-w-full cursor-zoom-in">
          {image}
        </files.Link>
      ) : (
        <span key={key}>{image}</span>
      );
    }
    case "attachment": {
      const files = context.files;
      if (typeof node.attrs?.fileId !== "string" || !files) return null;
      return (
        <files.Link key={key} fileId={node.attrs.fileId} fileName={typeof node.attrs.fileName === "string" ? node.attrs.fileName : undefined} className="flex w-fit max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
          <span aria-hidden>📎</span>
          <span className="truncate">{String(node.attrs.fileName ?? "")}</span>
          {typeof node.attrs.sizeBytes === "number" ? <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(node.attrs.sizeBytes)}</span> : null}
        </files.Link>
      );
    }
    default:
      return null;
  }
}

/**
 * A document as a reader sees it. `size` is the page's own reading size, or the smaller one a note
 * is shown in among other fields; everything inside scales from it. A document with uploaded files
 * names how they are reached — without `files`, those blocks are left out.
 */
export function RenderDoc({ doc, files, size = "page", className }: { doc: Doc; files?: DocFiles; size?: "page" | "note"; className?: string }) {
  const context: Context = { headings: 0, files };
  return <div className={cn("flex min-w-0 flex-col break-words", size === "page" ? "gap-3 text-[0.95rem]" : "gap-2 text-sm", className)}>{(doc.content ?? []).map((node, index) => renderNode(node, String(index), context))}</div>;
}
