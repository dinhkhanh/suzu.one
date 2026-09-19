// The knowledge base's entry point for other modules (and for its own routes). Nothing here
// decides access by itself unless it takes a viewer: `kbViewerOf(user)` makes one, the policy
// functions and the SQL filters answer for it.
import "server-only";

export { pagePublishedVisibleSql, pageVisibleSql, spaceEditableSql, spaceManagedSql, spaceVisibleSql } from "./access-sql";
export { type Doc, type DocNode, docToPlainText, EMPTY_DOC, fileIdsOf, outlineOf, validateDoc } from "./engine/doc";
export { findPageFile, listPageFiles, PAGE_FILE_OWNER, pageFileLink } from "./files";
export * from "./pages";
export { atLeast, canCreatePage, canEditPage, canManageAnySpace, canManageSpace, canOrganisePages, canPublishDirectly, canViewPage, type KbLevel, type KbViewer, kbViewerOf, pageLevel, spaceLevel, viewerKeys } from "./policy";
export * from "./spaces";
