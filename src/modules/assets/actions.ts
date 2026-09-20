"use server";
// Every mutation of the register, through the one pipeline (parse → authenticate → authorize →
// run → audit). Nothing here writes to the database itself: the use-cases live in service.ts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { assignAsset, bookAsset, cancelBooking, checkInBooking, checkOutBooking, confirmHandover, decideBooking, findAssignment, findAsset, findBooking, findLicence, registerAsset, returnAsset, saveCategory, saveLicence, setAssetStatus, updateAsset } from "./service";
import { windowProblems } from "./engine/booking";
import { ASSET_CONDITIONS, ASSET_KINDS, ASSET_STATUSES, BILLING_CYCLES, HOLDER_TYPES, LICENCE_STATUSES } from "./enums";
import { canActOnBooking, canBookAssets, canConfirmHandover, canDecideBookings, canManageAssets, canManageCategories, canManageLicences } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// "12.500.000" and "12,500,000" are how a price gets typed; integer đồng, never a decimal.
const money = z.preprocess((value) => (typeof value === "string" ? value.replace(/[.,\s]/g, "") : value), z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER));

function refresh(assetId?: string) {
  revalidatePath("/assets");
  revalidatePath("/assets/mine");
  if (assetId) revalidatePath(`/assets/${assetId}`);
}

const assetFields = {
  categoryId: z.uuid(),
  entityId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  brand: optional(z.string().trim().max(80)),
  model: optional(z.string().trim().max(120)),
  serial: optional(z.string().trim().max(120)),
  purchaseDate: optional(isoDate),
  purchasePrice: optional(money),
  supplier: optional(z.string().trim().max(200)),
  warrantyUntil: optional(isoDate),
  condition: z.enum(ASSET_CONDITIONS),
  location: optional(z.string().trim().max(200)),
  notes: optional(z.string().trim().max(2000)),
};

const registerAssetPipeline = createAction({
  name: "asset.register",
  input: z.object(assetFields),
  authorize: (user, input) => canManageAssets(user.principal, input.entityId),
  run: async ({ user, input }) => {
    const asset = await registerAsset(input, user.person.id);
    refresh(asset.id);
    // The audit log names the thing, never what it cost.
    return { data: { id: asset.id, code: asset.code }, audit: { resource: { type: "asset", id: asset.id, entityId: asset.entityId }, summary: `${asset.code} ${asset.name}` } };
  },
});

const updateAssetPipeline = createAction({
  name: "asset.update",
  input: z.object({ assetId: z.uuid(), ...assetFields }),
  authorize: async (user, input) => {
    const asset = await findAsset(input.assetId);
    // Authority over where it is now *and* over where it is going, when the entity changes.
    return !!asset && canManageAssets(user.principal, asset.entityId) && canManageAssets(user.principal, input.entityId);
  },
  run: async ({ user, input }) => {
    const { assetId, ...fields } = input;
    const { before, after } = await updateAsset(assetId, fields, user.person.id);
    refresh(assetId);
    return { data: { id: after.id }, audit: { resource: { type: "asset", id: assetId, entityId: after.entityId }, summary: after.code, before: { name: before.name, status: before.status }, after: { name: after.name, status: after.status } } };
  },
});

const assignAssetPipeline = createAction({
  name: "asset.assign",
  input: z.object({
    assetId: z.uuid(),
    holderType: z.enum(HOLDER_TYPES),
    holderId: z.uuid(),
    conditionOut: z.enum(ASSET_CONDITIONS),
    dueBack: optional(isoDate),
    purpose: optional(z.string().trim().max(500)),
    // One per line: charger, case, spare battery.
    accessories: z.preprocess((value) => (typeof value === "string" ? value.split("\n").map((line) => line.trim()).filter(Boolean) : (value ?? [])), z.array(z.string().max(120)).max(30).default([])),
  }),
  authorize: async (user, input) => {
    const asset = await findAsset(input.assetId);
    return !!asset && canManageAssets(user.principal, asset.entityId);
  },
  run: async ({ user, input }) => {
    const assignment = await assignAsset(input, user.person.id);
    const asset = await findAsset(input.assetId);
    refresh(input.assetId);
    revalidatePath("/tasks");
    return { data: { assignmentId: assignment.id }, audit: { resource: { type: "asset", id: input.assetId, entityId: asset?.entityId ?? null }, summary: asset?.code ?? input.assetId, after: { holderType: input.holderType, holderId: input.holderId } } };
  },
});

/** The holder's own acknowledgement. Nobody may tick it for them — that is the whole point of it. */
const confirmHandoverPipeline = createAction({
  name: "asset.handover.confirm",
  input: z.object({ assignmentId: z.uuid(), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const found = await findAssignment(input.assignmentId);
    return !!found && canConfirmHandover(user.principal, found.assignment.holderPersonId);
  },
  run: async ({ user, input }) => {
    const after = await confirmHandover(input.assignmentId, user.person.id, input.note);
    const found = await findAssignment(input.assignmentId);
    refresh(found?.asset.id);
    return { data: { confirmedAt: after.handoverConfirmedAt }, audit: { resource: { type: "asset_assignment", id: input.assignmentId, entityId: found?.asset.entityId ?? null }, summary: found?.asset.code ?? input.assignmentId } };
  },
});

const returnAssetPipeline = createAction({
  name: "asset.return",
  input: z.object({ assignmentId: z.uuid(), conditionIn: z.enum(ASSET_CONDITIONS), returnNote: optional(z.string().trim().max(1000)), location: optional(z.string().trim().max(200)) }),
  authorize: async (user, input) => {
    const found = await findAssignment(input.assignmentId);
    return !!found && canManageAssets(user.principal, found.asset.entityId);
  },
  run: async ({ user, input }) => {
    const found = await findAssignment(input.assignmentId);
    await returnAsset(input, user.person.id);
    refresh(found?.asset.id);
    revalidatePath("/tasks");
    return { data: { ok: true }, audit: { resource: { type: "asset_assignment", id: input.assignmentId, entityId: found?.asset.entityId ?? null }, summary: found?.asset.code ?? input.assignmentId, after: { conditionIn: input.conditionIn } } };
  },
});

const setAssetStatusPipeline = createAction({
  name: "asset.status",
  input: z.object({ assetId: z.uuid(), status: z.enum(ASSET_STATUSES), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const asset = await findAsset(input.assetId);
    return !!asset && canManageAssets(user.principal, asset.entityId);
  },
  run: async ({ user, input }) => {
    const { before, after } = await setAssetStatus(input.assetId, input.status, input.note, user.person.id);
    refresh(input.assetId);
    return { data: { status: after.status }, audit: { resource: { type: "asset", id: input.assetId, entityId: after.entityId }, summary: after.code, before: { status: before.status }, after: { status: after.status } } };
  },
});

const saveAssetCategoryPipeline = createAction({
  name: "asset.category.save",
  input: z.object({
    categoryId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(ASSET_KINDS),
    requiresSerial: checkbox,
    defaultWarrantyMonths: optional(z.coerce.number().int().min(0).max(240)),
    bookable: checkbox,
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    isActive: checkbox,
  }),
  authorize: (user) => canManageCategories(user.principal),
  run: async ({ input }) => {
    const { categoryId, ...fields } = input;
    const { before, after } = await saveCategory(categoryId, fields);
    revalidatePath("/assets/categories");
    revalidatePath("/assets");
    return { data: { id: after.id }, audit: { resource: { type: "asset_category", id: after.id }, summary: after.code, before: before && { name: before.name }, after: { name: after.name } } };
  },
});


// ── Booking shared gear (FR-AST-03) ─────────────────────────────────────────────────────────

function refreshBookings(assetId?: string) {
  revalidatePath("/assets/bookings");
  revalidatePath("/assets/mine");
  if (assetId) revalidatePath(`/assets/${assetId}`);
}

// A datetime as the form sends it: "2026-09-25T09:00". Read as Vietnam time, which is where the
// gear and the people are; the column is timestamptz, so the instant is unambiguous once stored.
const vietnamInstant = z.preprocess((value) => {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
  return new Date(`${value.slice(0, 16)}:00+07:00`);
}, z.date());

const bookAssetPipeline = createAction({
  name: "asset.booking.create",
  input: z.object({
    assetId: z.uuid(),
    // Booking on somebody else's behalf is the keeper's privilege; the authorize step below checks it.
    personId: optional(z.uuid()),
    startAt: vietnamInstant,
    endAt: vietnamInstant,
    purpose: optional(z.string().trim().max(500)),
    projectRef: optional(z.string().trim().max(60)),
  }),
  authorize: async (user, input) => {
    if (!canBookAssets(user.principal)) return false;
    // For yourself: anybody. For somebody else: only whoever keeps that entity's gear.
    if (!input.personId || input.personId === user.person.id) return true;
    const asset = await findAsset(input.assetId);
    return !!asset && canManageAssets(user.principal, asset.entityId);
  },
  run: async ({ user, input }) => {
    const problems = windowProblems({ startAt: input.startAt, endAt: input.endAt }, new Date());
    if (problems.length > 0) throw new ActionError(problems[0]);
    const booking = await bookAsset({ assetId: input.assetId, personId: input.personId ?? user.person.id, startAt: input.startAt, endAt: input.endAt, purpose: input.purpose, projectRef: input.projectRef }, { personId: user.person.id, principal: user.principal });
    const asset = await findAsset(input.assetId);
    refreshBookings(input.assetId);
    return {
      data: { id: booking.id, status: booking.status },
      audit: { resource: { type: "asset_booking", id: booking.id, entityId: asset?.entityId ?? null }, summary: `${asset?.code ?? input.assetId} ${input.startAt.toISOString()} → ${input.endAt.toISOString()}`, after: { status: booking.status, personId: booking.personId } },
    };
  },
});

const decideBookingPipeline = createAction({
  name: "asset.booking.decide",
  input: z.object({ bookingId: z.uuid(), decision: z.enum(["confirm", "refuse"]), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const booking = await findBooking(input.bookingId);
    return !!booking && canDecideBookings(user.principal, booking.assetEntityId);
  },
  run: async ({ user, input }) => {
    const before = await findBooking(input.bookingId);
    const after = await decideBooking(input.bookingId, input.decision, input.note, user.person.id);
    refreshBookings(before?.assetId);
    return { data: { status: after.status }, audit: { resource: { type: "asset_booking", id: input.bookingId, entityId: before?.assetEntityId ?? null }, summary: before?.assetCode ?? input.bookingId, before: { status: before?.status }, after: { status: after.status } } };
  },
});

const cancelBookingPipeline = createAction({
  name: "asset.booking.cancel",
  input: z.object({ bookingId: z.uuid(), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const booking = await findBooking(input.bookingId);
    return !!booking && canActOnBooking(user.principal, { personId: booking.personId, entityId: booking.assetEntityId });
  },
  run: async ({ user, input }) => {
    const before = await findBooking(input.bookingId);
    const after = await cancelBooking(input.bookingId, input.note, user.person.id);
    refreshBookings(before?.assetId);
    return { data: { status: after.status }, audit: { resource: { type: "asset_booking", id: input.bookingId, entityId: before?.assetEntityId ?? null }, summary: before?.assetCode ?? input.bookingId, before: { status: before?.status }, after: { status: after.status } } };
  },
});

const checkOutBookingPipeline = createAction({
  name: "asset.booking.check_out",
  input: z.object({ bookingId: z.uuid(), conditionOut: z.enum(ASSET_CONDITIONS), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const booking = await findBooking(input.bookingId);
    return !!booking && canActOnBooking(user.principal, { personId: booking.personId, entityId: booking.assetEntityId });
  },
  run: async ({ user, input }) => {
    const before = await findBooking(input.bookingId);
    const after = await checkOutBooking(input, user.person.id);
    refreshBookings(before?.assetId);
    return { data: { status: after.status }, audit: { resource: { type: "asset_booking", id: input.bookingId, entityId: before?.assetEntityId ?? null }, summary: before?.assetCode ?? input.bookingId, after: { status: after.status, conditionOut: input.conditionOut } } };
  },
});

const checkInBookingPipeline = createAction({
  name: "asset.booking.check_in",
  input: z.object({ bookingId: z.uuid(), conditionIn: z.enum(ASSET_CONDITIONS), note: optional(z.string().trim().max(1000)) }),
  authorize: async (user, input) => {
    const booking = await findBooking(input.bookingId);
    return !!booking && canActOnBooking(user.principal, { personId: booking.personId, entityId: booking.assetEntityId });
  },
  run: async ({ user, input }) => {
    const before = await findBooking(input.bookingId);
    const after = await checkInBooking(input, user.person.id);
    refreshBookings(before?.assetId);
    return { data: { status: after.status }, audit: { resource: { type: "asset_booking", id: input.bookingId, entityId: before?.assetEntityId ?? null }, summary: before?.assetCode ?? input.bookingId, after: { status: after.status, conditionIn: input.conditionIn } } };
  },
});

// ── Licences and subscriptions (FR-AST-05) ──────────────────────────────────────────────────

const saveLicencePipeline = createAction({
  name: "asset.licence.save",
  input: z.object({
    licenceId: optional(z.uuid()),
    name: z.string().trim().min(1).max(200),
    vendor: optional(z.string().trim().max(120)),
    entityId: z.uuid(),
    seats: optional(z.coerce.number().int().min(0).max(100_000)),
    seatHolderPersonIds: z.preprocess((value) => (Array.isArray(value) ? value : value ? [value] : []), z.array(z.uuid()).max(500).default([])),
    costPerCycle: optional(money),
    billingCycle: z.enum(BILLING_CYCLES),
    renewalDate: optional(isoDate),
    autoRenews: checkbox,
    ownerPersonId: optional(z.uuid()),
    assetId: optional(z.uuid()),
    accountRef: optional(z.string().trim().max(200)),
    notes: optional(z.string().trim().max(2000)),
    status: z.enum(LICENCE_STATUSES),
  }),
  authorize: async (user, input) => {
    // Authority over where it sits now *and* over where it is going, when the entity changes.
    if (!canManageLicences(user.principal, input.entityId)) return false;
    if (!input.licenceId) return true;
    const before = await findLicence(input.licenceId);
    return !!before && canManageLicences(user.principal, before.entityId);
  },
  run: async ({ user, input }) => {
    const { licenceId, ...fields } = input;
    const { before, after } = await saveLicence(licenceId, fields, user.person.id);
    revalidatePath("/assets/licences");
    revalidatePath("/ops");
    // The audit names the subscription and its renewal date, never what it costs.
    return {
      data: { id: after.id },
      audit: { resource: { type: "licence", id: after.id, entityId: after.entityId }, summary: after.name, before: before && { status: before.status, renewalDate: before.renewalDate }, after: { status: after.status, renewalDate: after.renewalDate } },
    };
  },
});

// A `"use server"` file may export nothing but async functions — exporting the pipeline as a
// const makes the bundler drop every export of the module (tests/server-actions.test.ts).

export async function registerAssetAction(input: unknown) {
  return registerAssetPipeline(input);
}

export async function updateAssetAction(input: unknown) {
  return updateAssetPipeline(input);
}

export async function assignAssetAction(input: unknown) {
  return assignAssetPipeline(input);
}

export async function confirmHandoverAction(input: unknown) {
  return confirmHandoverPipeline(input);
}

export async function returnAssetAction(input: unknown) {
  return returnAssetPipeline(input);
}

export async function setAssetStatusAction(input: unknown) {
  return setAssetStatusPipeline(input);
}

export async function saveAssetCategoryAction(input: unknown) {
  return saveAssetCategoryPipeline(input);
}

export async function bookAssetAction(input: unknown) {
  return bookAssetPipeline(input);
}

export async function decideBookingAction(input: unknown) {
  return decideBookingPipeline(input);
}

export async function cancelBookingAction(input: unknown) {
  return cancelBookingPipeline(input);
}

export async function checkOutBookingAction(input: unknown) {
  return checkOutBookingPipeline(input);
}

export async function checkInBookingAction(input: unknown) {
  return checkInBookingPipeline(input);
}

export async function saveLicenceAction(input: unknown) {
  return saveLicencePipeline(input);
}
