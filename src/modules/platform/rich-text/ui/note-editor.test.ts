// The stand-in drawn while the editor's code loads must post what the editor would have: the same
// note under the same name, still required — a form sent in that moment loses nothing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { NoteEditorStandIn } from "./note-editor";

const render = (props: Parameters<typeof NoteEditorStandIn>[0]) => renderToStaticMarkup(createElement(NoteEditorStandIn, props));

describe("NoteEditorStandIn", () => {
  test("posts the opening note under the field's name, and keeps it required", () => {
    const html = render({ id: "description", name: "description", defaultValue: "Gọi lại **khách**", required: true, rows: 4 });
    expect(html).toMatch(/<textarea[^>]*id="description"[^>]*name="description"[^>]*required=""/);
    expect(html).toContain(">Gọi lại **khách**</textarea>");
    // The note reads as it will in the editor, and the box opens at the editor's height.
    expect(html).toContain("<strong>khách</strong>");
    expect(html).toContain("min-height:7.8em");
  });

  test("a held value wins over the opening one; a field without one posts nothing", () => {
    expect(render({ name: "body", defaultValue: "old", value: "new" })).toContain(">new</textarea>");
    expect(render({ name: "body" })).toMatch(/<textarea[^>]*name="body"[^>]*><\/textarea>/);
  });

  test("a disabled editor has no toolbar row and posts nothing", () => {
    const html = render({ name: "body", defaultValue: "x", disabled: true });
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).not.toContain("border-b");
  });
});
