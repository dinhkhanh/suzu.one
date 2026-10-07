// The input schemas of the work actions another module calls by name: the assistant's proposals
// (Phase 13 R4) check a proposed change against the very schema the action parses it with. Here and
// not in `actions.ts` because a `"use server"` file may export nothing but async functions.
import { z } from "zod";
import { MAX_LINKED_DIGITAL_ASSETS } from "./digital-links";
import { MAX_LINKED_CHECKLISTS, MAX_TASK_CHECKLIST } from "./engine/checklists";
import { CHANNELS, CONTENT_FORMATS } from "./enums";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
/** For patches: absent = leave alone, blank = clear. */
const patchable = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable()).optional();
const isoDate = z.iso.date();

export const createTaskInput = z.object({
  teamId: z.uuid(),
  projectId: patchable(z.uuid()),
  title: z.string().trim().min(1).max(200),
  description: optional(z.string().trim().max(10000)),
  stateId: optional(z.uuid()),
  assigneePersonId: optional(z.uuid()),
  priority: optional(z.coerce.number().int().min(1).max(4)),
  startDate: optional(isoDate),
  dueDate: optional(isoDate),
  estimateMinutes: optional(z.coerce.number().int().min(1).max(60000)),
  clientId: patchable(z.uuid()),
  channel: optional(z.enum(CHANNELS)),
  contentFormat: optional(z.enum(CONTENT_FORMATS)),
  parentTaskId: optional(z.uuid()),
  labelIds: z.array(z.uuid()).max(20).default([]),
  digitalAssetIds: z.array(z.uuid()).max(MAX_LINKED_DIGITAL_ASSETS).default([]),
  collaboratorIds: z.array(z.uuid()).max(20).default([]),
});

/** FR-PJM-35: values are checked against the field's type by the service (engine/custom-fields.ts). */
const customValuesInput = z.record(z.uuid(), z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(40)).max(50), z.null()])).refine((values) => Object.keys(values).length <= 30);

const checklistItem = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(200), done: z.boolean() });
const linkItem = z.object({ id: z.string().min(1).max(40), url: z.url({ protocol: /^https$/ }).max(1000), title: optional(z.string().trim().max(120)) });

export const updateTaskInput = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: patchable(z.string().trim().max(10000)),
  stateId: z.uuid().optional(),
  assigneePersonId: patchable(z.uuid()),
  requesterPersonId: patchable(z.uuid()),
  reviewerPersonId: patchable(z.uuid()),
  priority: patchable(z.coerce.number().int().min(1).max(4)),
  startDate: patchable(isoDate),
  dueDate: patchable(isoDate),
  estimateMinutes: patchable(z.coerce.number().int().min(1).max(60000)),
  projectId: patchable(z.uuid()),
  clientId: patchable(z.uuid()),
  channel: patchable(z.enum(CHANNELS)),
  contentFormat: patchable(z.enum(CONTENT_FORMATS)),
  parentTaskId: patchable(z.uuid()),
  labelIds: z.array(z.uuid()).max(20).optional(),
  digitalAssetIds: z.array(z.uuid()).max(MAX_LINKED_DIGITAL_ASSETS).optional(),
  collaboratorIds: z.array(z.uuid()).max(20).optional(),
  checklist: z.array(checklistItem).max(MAX_TASK_CHECKLIST).optional(),
  addChecklistIds: z.array(z.uuid()).min(1).max(MAX_LINKED_CHECKLISTS).optional(),
  links: z.array(linkItem).max(30).optional(),
  position: z.object({ beforeTaskId: optional(z.uuid()), afterTaskId: optional(z.uuid()) }).optional(),
  customValues: customValuesInput.optional(),
  cycleId: patchable(z.uuid()),
});

export const commentBody = z.string().trim().min(1).max(5000);

export const addCommentInput = z.object({ taskId: z.uuid(), body: commentBody, parentId: optional(z.uuid()) });

export const raiseBlockerInput = z.object({ taskId: z.uuid(), reason: z.string().trim().min(1).max(500), neededPersonId: optional(z.uuid()) });

export const resolveBlockerInput = z.object({ taskId: z.uuid(), resolution: optional(z.string().trim().max(500)) });
