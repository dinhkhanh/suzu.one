// A note goes Markdown → document → the editor's schema → document → Markdown every time it is
// edited. Whatever a note can hold has to make that trip unchanged. No DOM needed.
import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import type { Doc } from "../engine/doc";
import { docToNote, noteToDoc } from "../engine/note";
import { textExtensions } from "./extensions";

const schema = getSchema(textExtensions());

const NOTE = [
  "## Bối cảnh",
  "Khách cần **bản demo** trước *thứ Sáu*, xem [brief](https://example.com/brief) và `config_v2.json`.\nDòng thứ hai.",
  "1. Dựng màn hình\n2. Gửi link\n   - kèm hướng dẫn",
  "- [x] Đã có tài khoản\n- [ ] Chờ dữ liệu",
  "> [!WARNING]\n> Không gửi dữ liệu thật.",
  "> Trích lời khách",
  "```\nnpm run demo\n```",
  "| Việc | Ai |\n| --- | --- |\n| Demo | An |",
].join("\n\n");

describe("a note in the editor", () => {
  it("loads into the editor's schema and writes back the same Markdown", () => {
    const node = ProseMirrorNode.fromJSON(schema, noteToDoc(NOTE));
    node.check();
    expect(docToNote(node.toJSON() as Doc)).toBe(NOTE);
  });
});
