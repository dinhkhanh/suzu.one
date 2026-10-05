"use client";
// The note editor, loaded on demand. Tiptap and ProseMirror are most of a form's JavaScript, and
// more than forty forms carry a note — most of them inside a sheet that may never be opened. So
// what a form imports is this: the editor itself (note-editor-impl.tsx) is fetched the first time
// one is drawn, and until it arrives a stand-in of the same size holds its place.
//
// The stand-in is a form control too: it posts the same note under the same `name` (and keeps
// `required`), so a form sent in that moment sends what the editor would have.
import { lazy, Suspense } from "react";
import { RichText } from "./rich-text";
import type { NoteEditorProps } from "./note-editor-impl";
import { noteEditorFrame, noteMinHeight } from "./note-editor-frame";

const Editor = lazy(() => import("./note-editor-impl").then((module) => ({ default: module.NoteEditor })));

export type { NoteEditorProps };

export function NoteEditor(props: NoteEditorProps) {
  return (
    <Suspense fallback={<NoteEditorStandIn {...props} />}>
      <Editor {...props} />
    </Suspense>
  );
}

/** The editor's box while its code loads: the toolbar's row, the note as it reads, the same height. */
export function NoteEditorStandIn({ id, name, form, defaultValue, value, required, disabled, rows = 3, className, "aria-invalid": ariaInvalid }: NoteEditorProps) {
  const note = value ?? defaultValue ?? "";
  return (
    <div data-slot="note-editor" aria-busy="true" aria-invalid={ariaInvalid || undefined} className={noteEditorFrame(disabled, className)}>
      <textarea id={id} name={name} form={form} defaultValue={note} required={required} disabled={disabled} tabIndex={-1} aria-hidden className="sr-only" />
      {disabled ? null : <div aria-hidden className="box-content h-8 border-b" />}
      <div aria-hidden className="px-2.5 py-2 text-base md:text-sm" style={{ minHeight: noteMinHeight(rows) }}>
        <RichText text={note} />
      </div>
    </div>
  );
}
