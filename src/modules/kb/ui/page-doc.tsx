// A knowledge-base page as a reader sees it: the shared document view, with the page's uploads
// reached through the permission-checked file route.
import type { Doc } from "@/modules/platform/rich-text/engine/doc";
import { type DocFiles, RenderDoc } from "@/modules/platform/rich-text/ui/render-doc";
import { KbFileLink } from "./kb-file-link";

// The same address KbFileLink opens. Kept here, not imported from it: a server component cannot
// call a function exported by a client module.
const KB_FILES: DocFiles = { href: (fileId) => `/api/kb/files/${fileId}`, Link: KbFileLink };

export function PageDoc({ doc }: { doc: Doc }) {
  return <RenderDoc doc={doc} files={KB_FILES} />;
}
