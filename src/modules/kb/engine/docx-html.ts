// mammoth turns a .docx into a small, well-formed HTML vocabulary (h1–h6, p, strong, em, a, ul /
// ol / li, table / tr / td / th, br, img). This turns THAT into Markdown for `markdownToDoc` — so a
// Word import goes through the same gate as every other import and no HTML is ever kept. Pure; no
// DOM. Anything outside the vocabulary contributes its text and nothing else.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
  });
// Text must stay text: what Markdown would read as syntax is escaped.
const escapeText = (value: string): string => value.replace(/([\\`*_[\]<>|#~])/g, "\\$1");

type Piece = { tag: string; closing: boolean; attrs: string } | { text: string };

function pieces(html: string): Piece[] {
  const out: Piece[] = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (match[4] !== undefined) out.push({ text: decode(match[4]) });
    else out.push({ tag: match[2].toLowerCase(), closing: match[1] === "/", attrs: match[3] ?? "" });
  }
  return out;
}

const hrefOf = (attrs: string): string | null => {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return match ? decode(match[1] ?? match[2] ?? "") : null;
};

export function mammothHtmlToMarkdown(html: string): string {
  const lines: string[] = [];
  let inline = "";
  let href: string | null = null;
  const lists: { ordered: boolean; count: number }[] = [];
  let table: string[][] | null = null;
  let cell: string | null = null;

  const flush = (prefix = "") => {
    const text = inline.replace(/[ \t]+/g, " ").trim();
    inline = "";
    if (text) lines.push(`${prefix}${text}`, "");
  };
  const add = (value: string) => {
    if (cell !== null) cell += value;
    else inline += value;
  };

  for (const piece of pieces(html)) {
    if ("text" in piece) {
      add(escapeText(piece.text.replace(/\s+/g, " ")));
      continue;
    }
    const { tag, closing } = piece;
    if (/^h[1-6]$/.test(tag)) {
      if (closing) flush(`${"#".repeat(Number(tag[1]))} `);
      else flush();
    } else if (tag === "p") {
      if (cell !== null) {
        if (closing) cell += " ";
      } else if (closing && lists.length === 0) flush();
      else if (closing) inline += " ";
    } else if (tag === "strong" || tag === "b") add("**");
    else if (tag === "em" || tag === "i") add("_");
    else if (tag === "s" || tag === "del" || tag === "strike") add("~~");
    else if (tag === "br") add(cell !== null ? " " : "  \n");
    else if (tag === "a") {
      if (!closing) {
        href = hrefOf(piece.attrs);
        if (href) add("[");
      } else if (href) {
        add(`](${href.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`);
        href = null;
      }
    } else if (tag === "ul" || tag === "ol") {
      if (!closing) {
        // A list inside an item: the item's own text comes first.
        if (lists.length) itemLine();
        else flush();
        lists.push({ ordered: tag === "ol", count: 0 });
      } else {
        lists.pop();
        if (lists.length === 0) lines.push("");
      }
    } else if (tag === "li") {
      if (closing) itemLine();
      else if (lists.length) lists[lists.length - 1].count++;
    } else if (tag === "table") {
      if (!closing) {
        flush();
        table = [];
      } else if (table) {
        const width = Math.max(1, ...table.map((row) => row.length));
        const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
        if (table.length) lines.push(row(table[0]), `|${" --- |".repeat(width)}`, ...table.slice(1).map(row), "");
        table = null;
      }
    } else if (tag === "tr" && table && !closing) table.push([]);
    else if ((tag === "td" || tag === "th") && table) {
      if (!closing) cell = "";
      else if (cell !== null) {
        table.at(-1)?.push(cell.replace(/\s+/g, " ").trim());
        cell = null;
      }
    }
    // img and everything else: nothing. Pictures inside a Word file are not imported.
  }
  flush();
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;

  function itemLine() {
    const text = inline.replace(/\s+/g, " ").trim();
    inline = "";
    const list = lists.at(-1);
    if (!text || !list) return;
    lines.push(`${"   ".repeat(lists.length - 1)}${list.ordered ? `${list.count}.` : "-"} ${text}`);
  }
}
