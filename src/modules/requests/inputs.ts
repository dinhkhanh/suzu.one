// The input schemas of the request actions another module calls by name: the assistant's proposals
// (Phase 13 R4) check a proposed request against the very schema the action parses it with. Here
// and not in `actions.ts` because a `"use server"` file may export nothing but async functions.
import { z } from "zod";
import { MAX_TEXT } from "./engine/form";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** The answers arrive as a flat record; the engine coerces and checks each one against its field. */
export const requestAnswers = z.record(z.string().max(40), z.union([z.string().max(MAX_TEXT), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).nullable()).default({});

/** `request.file`. `parentRequestId`: the request this one is filed under (FR-REQ-05); the service checks it may be. */
export const fileRequestInput = z.object({ code: z.string().trim().min(1).max(40), values: requestAnswers, parentRequestId: z.preprocess(blankToNull, z.uuid().nullable().default(null)) });
