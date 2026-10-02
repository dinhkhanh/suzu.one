"use server";
// Giving out and taking back the seats of a licence or subscription (FR-AST-11), through the one
// pipeline. Whoever keeps the register of the licence's entity hands out its seats.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canManageLicences } from "./policy";
import { assignSeat, findSeat, releaseSeat } from "./seats";
import { findLicence } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));

function refresh(licenceId: string, assetId?: string | null) {
  revalidatePath("/assets/licences");
  revalidatePath(`/assets/licences/${licenceId}`);
  revalidatePath("/assets/mine");
  if (assetId) revalidatePath(`/assets/${assetId}`);
}

const assignSeatPipeline = createAction({
  name: "asset.licence.seat.assign",
  // The form sends one of the two, by what the seat is for: a person, or a device.
  input: z.object({ licenceId: z.uuid(), personId: optional(z.uuid()), assetId: optional(z.uuid()), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const licence = await findLicence(input.licenceId);
    return !!licence && canManageLicences(user.principal, licence.entityId);
  },
  run: async ({ user, input }) => {
    const { seat, licence } = await assignSeat(input, user.person.id);
    refresh(licence.id, seat.assetId);
    return { data: { id: seat.id }, audit: { resource: { type: "licence_seat", id: seat.id, entityId: licence.entityId }, summary: licence.name, after: { personId: seat.personId, assetId: seat.assetId } } };
  },
});

const releaseSeatPipeline = createAction({
  name: "asset.licence.seat.release",
  input: z.object({ seatId: z.uuid(), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const found = await findSeat(input.seatId);
    return !!found && canManageLicences(user.principal, found.licence.entityId);
  },
  run: async ({ user, input }) => {
    const { seat, licence } = await releaseSeat(input.seatId, input.note, user.person.id);
    refresh(licence.id, seat.assetId);
    revalidatePath("/today");
    return { data: { id: seat.id }, audit: { resource: { type: "licence_seat", id: seat.id, entityId: licence.entityId }, summary: licence.name, before: { personId: seat.personId, assetId: seat.assetId } } };
  },
});

export async function assignSeatAction(input: unknown) {
  return assignSeatPipeline(input);
}

export async function releaseSeatAction(input: unknown) {
  return releaseSeatPipeline(input);
}
