// A note as a reader sees it: the stored Markdown built into the document and rendered from that,
// never as HTML. Works on the server and in the browser. Nothing is shown for an empty note.
import { noteToDoc } from "../engine/note";
import { RenderDoc } from "./render-doc";

export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null;
  return <RenderDoc doc={noteToDoc(text)} size="note" className={className} />;
}
