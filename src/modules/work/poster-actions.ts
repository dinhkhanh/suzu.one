"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canManageProject } from "./policy";
import { beginPosterUpload, completePosterUpload, isPendingPoster, removePoster } from "./poster";
import { findProject, projectFacts } from "./projects";
import { loadViewer } from "./viewer";

// A project's poster: the browser shrinks it, then uploads it straight to storage through a signed
// URL (`uploadThroughSignedUrl`). Whoever runs the project (`canManageProject`) changes it.

const mayChange = async (user: Parameters<typeof loadViewer>[0], projectId: string) => {
  const found = await findProject(projectId);
  return !!found && canManageProject(await loadViewer(user), projectFacts(found.project, found.team));
};

// The poster shows on the work pages and the plan pages of the project, and in project lists.
function refresh(projectId: string) {
  revalidatePath("/work");
  revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`, "layout");
}

const beginPipeline = createAction({
  name: "work.project.poster.begin",
  input: z.object({ projectId: z.uuid(), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => mayChange(user, input.projectId),
  run: async ({ user, input }) => {
    const found = await findProject(input.projectId);
    const entityId = found?.project.entityId ?? null;
    const upload = await beginPosterUpload({ id: input.projectId, entityId }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "file", id: upload.fileId, entityId }, summary: `project poster: ${input.fileName}` } };
  },
});
export async function beginPosterUploadAction(input: unknown) {
  return beginPipeline(input);
}

const completePipeline = createAction({
  name: "work.project.poster.set",
  input: z.object({ projectId: z.uuid(), fileId: z.uuid() }),
  // Only the upload this actor began for this project: nobody puts up a file meant for another.
  authorize: async (user, input) => (await mayChange(user, input.projectId)) && isPendingPoster(input.fileId, input.projectId, user.person.id),
  run: async ({ user, input }) => {
    const file = await completePosterUpload(input.projectId, input.fileId, { personId: user.person.id, email: user.email });
    refresh(input.projectId);
    return { data: { fileId: file.id }, audit: { resource: { type: "work_project", id: input.projectId, entityId: file.entityId }, summary: "poster changed", after: { posterFileId: file.id } } };
  },
});
export async function completePosterUploadAction(input: unknown) {
  return completePipeline(input);
}

const removePipeline = createAction({
  name: "work.project.poster.remove",
  input: z.object({ projectId: z.uuid() }),
  authorize: (user, input) => mayChange(user, input.projectId),
  run: async ({ input }) => {
    const found = await findProject(input.projectId);
    const previous = await removePoster(input.projectId);
    refresh(input.projectId);
    return { data: { removed: !!previous }, audit: { resource: { type: "work_project", id: input.projectId, entityId: found?.project.entityId ?? null }, summary: "poster removed", before: { posterFileId: previous }, after: { posterFileId: null } } };
  },
});
export async function removePosterAction(input: unknown) {
  return removePipeline(input);
}
