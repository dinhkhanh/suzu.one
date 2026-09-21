// The knowledge base's entry point for other modules (and for its own routes). Nothing here
// decides access by itself unless it takes a viewer: `kbViewerOf(user)` makes one, the policy
// functions and the SQL filters answer for it.
import "server-only";

export { pagePublishedVisibleSql, pageVisibleSql, spaceEditableSql, spaceManagedSql, spaceVisibleSql } from "./access-sql";
export { type Doc, type DocNode, docToPlainText, EMPTY_DOC, fileIdsOf, outlineOf, validateDoc } from "./engine/doc";
export { findPageFile, listPageFiles, listSpaceFiles, mayOpenPageFile, PAGE_FILE_OWNER, pageFileLink, type SpaceFileView } from "./files";
export * from "./pages";
export { atLeast, canCreatePage, canEditPage, canManageAnySpace, canManageSpace, canOrganisePages, canPublishDirectly, canViewPage, type KbLevel, type KbViewer, kbViewerOf, pageLevel, spaceLevel, spaceOwner, type ViewerSource, viewerKeys } from "./policy";
export * from "./spaces";
export { getPublishReview, kbPublishRequest, type PublishReviewView, syncReviewState } from "./publishing";
export * from "./acknowledgements";
export * from "./search";
export * from "./templates";
export { chunkStats, embedPendingChunks, type RetrievedChunk, retrieveKbChunks } from "./chunks";
export { embeddingDriver, embedTexts } from "./embeddings";
