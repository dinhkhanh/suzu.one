// The reading view of a page document: React elements built from the stored JSON, node by node.
// No HTML string is ever produced or injected — a node the renderer does not know is dropped, and
// every address goes through the same allow-list the validator used (a second time, on purpose).
import type { ReactNode } from "react";
import { type CalloutKind, CALLOUT_KINDS } from "../engine/callouts";
import { type Doc, type DocMark, type DocNode, headingId } from "../engine/doc";
import { isInternalHref, normalizeEmbed, safeHref } from "../engine/embed";

const CALLOUT_STYLE: Record<CalloutKind, string> = {
  info: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
  warning: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  success: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
  danger: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40",
};
const CALLOUT_ICON: Record<CalloutKind, string> = { info: "ℹ️", warning: "⚠️", success: "✅", danger: "⛔" };

export const fileHref = (fileId: string) => `/api/kb/files/${fileId}`;

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

type Context = { headings: number };

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
        <p key={key} className="leading-7">
          {children()}
        </p>
      );
    case "heading": {
      const id = headingId(context.headings++);
      const level = Number(node.attrs?.level ?? 1);
      if (level === 1)
        return (
          <h2 key={key} id={id} className="mt-4 scroll-mt-20 text-xl font-semibold tracking-tight">
            {children()}
          </h2>
        );
      if (level === 2)
        return (
          <h3 key={key} id={id} className="mt-3 scroll-mt-20 text-lg font-semibold">
            {children()}
          </h3>
        );
      return (
        <h4 key={key} id={id} className="mt-2 scroll-mt-20 text-base font-semibold">
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
    case "blockquote":
      return (
        <blockquote key={key} className="space-y-2 border-l-4 pl-4 text-muted-foreground">
          {children()}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
          <code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
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
      const src = typeof node.attrs?.fileId === "string" ? fileHref(node.attrs.fileId) : typeof node.attrs?.src === "string" && /^https:\/\//i.test(node.attrs.src) ? safeHref(node.attrs.src) : null;
      if (!src) return null;
      // eslint-disable-next-line @next/next/no-img-element -- private files behind a signed redirect: the image optimiser cannot fetch them
      return <img key={key} src={src} alt={String(node.attrs?.alt ?? "")} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-md border" />;
    }
    case "attachment":
      if (typeof node.attrs?.fileId !== "string") return null;
      return (
        <a key={key} href={fileHref(node.attrs.fileId)} className="flex w-fit max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
          <span aria-hidden>📎</span>
          <span className="truncate">{String(node.attrs.fileName ?? "")}</span>
          {typeof node.attrs.sizeBytes === "number" ? <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(node.attrs.sizeBytes)}</span> : null}
        </a>
      );
    default:
      return null;
  }
}

export function RenderDoc({ doc }: { doc: Doc }) {
  const context: Context = { headings: 0 };
  return <div className="flex flex-col gap-3 text-[0.95rem] break-words">{(doc.content ?? []).map((node, index) => renderNode(node, String(index), context))}</div>;
}
