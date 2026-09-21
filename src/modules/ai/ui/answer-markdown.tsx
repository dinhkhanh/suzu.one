"use client";
// An assistant answer, rendered from its Markdown (FR-AI-01).
//
// The body is untrusted twice over: the local driver quotes pages colleagues wrote, and a model
// writes whatever it writes. So nothing here produces HTML from it. `marked` only tokenises; each
// token becomes a React element, React escapes every string, raw HTML is shown as the text it is,
// pictures are not loaded, and a link is followed only when it is a path inside this app (through
// the router, which re-checks access on arrival) or an https address (opened without a referrer).
// Anything else — `javascript:`, `data:`, a protocol-relative `//host` — is shown as plain text.
import Link from "next/link";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode, useMemo } from "react";
import { type Citation, citationHref } from "../engine/answer";
import { answerLinkTarget } from "../engine/app-links";

/** "[2]" in a sentence: a link to the second citation, when there is one. */
function withCitations(text: string, citations: readonly Citation[], key: string): ReactNode {
  const parts = text.split(/(\[\d{1,2}\])/);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    const number = /^\[(\d{1,2})\]$/.exec(part)?.[1];
    const citation = number ? citations[Number(number) - 1] : undefined;
    if (!citation) return <Fragment key={`${key}-${index}`}>{part}</Fragment>;
    return (
      <sup key={`${key}-${index}`}>
        <Link href={citationHref(citation)} className="px-0.5 font-medium text-primary hover:underline" title={citation.pageTitle}>
          {number}
        </Link>
      </sup>
    );
  });
}

type Context = { citations: readonly Citation[] };

function inline(tokens: readonly Token[] | undefined, context: Context, key: string): ReactNode {
  return (tokens ?? []).map((token, index) => {
    const id = `${key}.${index}`;
    switch (token.type) {
      case "text":
      case "escape":
        return "tokens" in token && token.tokens?.length ? <Fragment key={id}>{inline(token.tokens, context, id)}</Fragment> : <Fragment key={id}>{withCitations(token.text, context.citations, id)}</Fragment>;
      case "strong":
        return <strong key={id}>{inline((token as Tokens.Strong).tokens, context, id)}</strong>;
      case "em":
        return <em key={id}>{inline((token as Tokens.Em).tokens, context, id)}</em>;
      case "del":
        return <s key={id}>{inline((token as Tokens.Del).tokens, context, id)}</s>;
      case "codespan":
        return (
          <code key={id} className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">
            {token.text}
          </code>
        );
      case "br":
        return <br key={id} />;
      case "link": {
        const link = token as Tokens.Link;
        const target = answerLinkTarget(link.href);
        const children = inline(link.tokens, context, id);
        if (!target) return <Fragment key={id}>{children}</Fragment>;
        return target.kind === "internal" ? (
          <Link key={id} href={target.href} className="font-medium text-primary underline-offset-2 hover:underline">
            {children}
          </Link>
        ) : (
          <a key={id} href={target.href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
            {children}
          </a>
        );
      }
      case "image":
        return <Fragment key={id}>{(token as Tokens.Image).text}</Fragment>;
      default:
        // Raw HTML and anything unknown: the characters themselves, escaped by React.
        return <Fragment key={id}>{"text" in token ? String(token.text) : token.raw}</Fragment>;
    }
  });
}

function blocks(tokens: readonly Token[], context: Context, key: string): ReactNode {
  return tokens.map((token, index) => {
    const id = `${key}/${index}`;
    switch (token.type) {
      case "space":
        return null;
      case "heading": {
        const heading = token as Tokens.Heading;
        return (
          <p key={id} className={heading.depth <= 3 ? "mt-1 text-[0.9375rem] font-semibold" : "mt-1 font-semibold"}>
            {inline(heading.tokens, context, id)}
          </p>
        );
      }
      case "paragraph":
        return <p key={id}>{inline((token as Tokens.Paragraph).tokens, context, id)}</p>;
      case "text":
        return <p key={id}>{inline((token as Tokens.Text).tokens ?? [token], context, id)}</p>;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => <li key={`${id}-${itemIndex}`}>{item.tokens.some((child) => child.type !== "text") ? blocks(item.tokens, context, `${id}-${itemIndex}`) : inline(item.tokens, context, `${id}-${itemIndex}`)}</li>);
        return list.ordered ? (
          <ol key={id} start={typeof list.start === "number" ? list.start : undefined} className="flex list-decimal flex-col gap-0.5 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={id} className="flex list-disc flex-col gap-0.5 pl-5">
            {items}
          </ul>
        );
      }
      case "table": {
        const table = token as Tokens.Table;
        const align = (value: Tokens.TableCell["align"]) => (value === "right" ? "text-right" : value === "center" ? "text-center" : "text-left");
        return (
          <div key={id} className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[0.8125rem]">
              <thead className="bg-muted/60">
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th key={cellIndex} className={`px-2.5 py-1.5 font-medium ${align(cell.align)}`}>
                      {inline(cell.tokens, context, `${id}-h${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={`px-2.5 py-1.5 align-top ${align(cell.align)}`}>
                        {inline(cell.tokens, context, `${id}-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "blockquote":
        return (
          <blockquote key={id} className="flex flex-col gap-1 rounded-lg border-l-4 border-border bg-muted/40 px-3 py-2">
            {blocks((token as Tokens.Blockquote).tokens, context, id)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={id} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[0.8125rem]">
            <code>{(token as Tokens.Code).text}</code>
          </pre>
        );
      case "hr":
        return <hr key={id} className="my-1 border-border" />;
      default:
        return <p key={id}>{"text" in token ? String(token.text) : token.raw}</p>;
    }
  });
}

export function AnswerMarkdown({ body, citations }: { body: string; citations: readonly Citation[] }) {
  // `breaks`: a line break in a quoted paragraph is a line break on the page it came from.
  const tokens = useMemo(() => marked.lexer(body, { gfm: true, breaks: true }), [body]);
  return <div className="flex flex-col gap-2 text-sm leading-relaxed">{blocks(tokens, { citations }, "md")}</div>;
}
