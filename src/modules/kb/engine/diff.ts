// A line diff between two plain texts, for "compare versions" (FR-KB-04). Pure.
// The plain text of a page is one line per block, so a changed paragraph shows as one removed and
// one added line — what a policy reviewer wants to see.

export type DiffLine = { type: "same" | "added" | "removed"; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  // Trim what both share at the ends: most edits touch a few lines of a long page.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const middle: DiffLine[] = [];
  if (midA.length * midB.length > MAX_CELLS) {
    // Too large to align: say what went and what came, in that order.
    middle.push(...midA.map((text) => ({ type: "removed" as const, text })), ...midB.map((text) => ({ type: "added" as const, text })));
  } else {
    // Longest common subsequence, filled from the end so the walk below goes forwards.
    const width = midB.length + 1;
    const table = new Uint32Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        middle.push({ type: "same", text: midA[i] });
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) middle.push({ type: "removed", text: midA[i++] });
      else middle.push({ type: "added", text: midB[j++] });
    }
    while (i < midA.length) middle.push({ type: "removed", text: midA[i++] });
    while (j < midB.length) middle.push({ type: "added", text: midB[j++] });
  }

  return [...a.slice(0, head).map((text) => ({ type: "same" as const, text })), ...middle, ...a.slice(a.length - tail).map((text) => ({ type: "same" as const, text }))];
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((line) => line.type === "added").length, removed: lines.filter((line) => line.type === "removed").length };
}
