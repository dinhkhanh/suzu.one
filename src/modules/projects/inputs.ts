// The input schemas of the project actions another module calls by name: the assistant's proposals
// (Phase 13 R4) check a proposed change against the very schema the action parses it with. Here and
// not in `actions.ts` because a `"use server"` file may export nothing but async functions.
import { z } from "zod";
import { HEALTHS } from "./engine/status";
import { text } from "./form-inputs";

/** `projects.status.post` (FR-PJM-27). */
export const postStatusUpdateInput = z.object({ projectId: z.uuid(), health: z.enum(HEALTHS), summary: z.string().trim().min(1).max(4000), highlights: text(4000), nextSteps: text(4000) });
