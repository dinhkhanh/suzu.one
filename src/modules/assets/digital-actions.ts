"use server";
// Every mutation of the digital-asset register (FR-AST-07, 08), through the one pipeline
// (parse → authenticate → authorize → run → audit). The use-cases live in digital.ts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { decideDigitalAccess, endDigitalAccess, findDigitalAccess, findDigitalAsset, grantDigitalAccess, markCredentialsRotated, requestDigitalAccess, saveDigitalAsset } from "./digital";
import { ACCESS_LEVELS, ACCESS_METHODS, DIGITAL_KINDS, DIGITAL_OWNERSHIPS, DIGITAL_PLATFORMS, DIGITAL_STATUSES, DIGITAL_VISIBILITIES } from "./enums";
import { canEndDigitalAccess, canManageDigitalAssets, canRequestDigitalAccess, canRunDigitalAsset } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function refresh(assetId: string) {
  revalidatePath("/assets/digital");
  revalidatePath(`/assets/digital/${assetId}`);
  revalidatePath("/assets/mine");
}

const saveDigitalAssetPipeline = createAction({
  name: "asset.digital.save",
  input: z.object({
    assetId: optional(z.uuid()),
    kind: z.enum(DIGITAL_KINDS),
    platform: z.enum(DIGITAL_PLATFORMS),
    name: z.string().trim().min(1).max(200),
    handle: optional(z.string().trim().max(200)),
    url: optional(z.url({ protocol: /^https$/ }).max(1000)),
    entityId: z.uuid(),
    ownership: z.enum(DIGITAL_OWNERSHIPS),
    clientId: optional(z.uuid()),
    ownerPersonId: optional(z.uuid()),
    visibility: z.enum(DIGITAL_VISIBILITIES),
    status: z.enum(DIGITAL_STATUSES),
    loginIdentity: optional(z.string().trim().max(200)),
    recoveryContact: optional(z.string().trim().max(200)),
    credentialLocation: optional(z.string().trim().max(300)),
    notes: optional(z.string().trim().max(2000)),
  }),
  authorize: async (user, input) => {
    // A new one: whoever keeps that entity's register.
    if (!input.assetId) return canManageDigitalAssets(user.principal, input.entityId);
    const before = await findDigitalAsset(input.assetId);
    if (!before || !canRunDigitalAsset(user.principal, before)) return false;
    // Moving it to another entity's books takes the register of both; the owner alone cannot.
    return before.entityId === input.entityId || (canManageDigitalAssets(user.principal, before.entityId) && canManageDigitalAssets(user.principal, input.entityId));
  },
  run: async ({ user, input }) => {
    const { assetId, ...fields } = input;
    const { before, after } = await saveDigitalAsset(assetId, fields, user.person.id);
    refresh(after.id);
    // The audit names the asset and who answers for it — never what it is registered under or where its password is.
    return {
      data: { id: after.id },
      audit: { resource: { type: "digital_asset", id: after.id, entityId: after.entityId }, summary: after.name, before: before && { name: before.name, status: before.status, ownerPersonId: before.ownerPersonId }, after: { name: after.name, status: after.status, ownerPersonId: after.ownerPersonId } },
    };
  },
});

const grantFields = { level: z.enum(ACCESS_LEVELS), method: z.enum(ACCESS_METHODS).default("own_account"), expiresOn: optional(isoDate), note: optional(z.string().trim().max(500)) };

const grantDigitalAccessPipeline = createAction({
  name: "asset.digital.access.grant",
  input: z.object({ assetId: z.uuid(), personId: z.uuid(), ...grantFields }),
  authorize: async (user, input) => {
    const asset = await findDigitalAsset(input.assetId);
    return !!asset && canRunDigitalAsset(user.principal, asset);
  },
  run: async ({ user, input }) => {
    const { access, asset, outcome } = await grantDigitalAccess(input, user.person.id);
    refresh(asset.id);
    return { data: { id: access.id, outcome }, audit: { resource: { type: "digital_asset_access", id: access.id, entityId: asset.entityId }, summary: asset.name, after: { personId: access.personId, level: access.level, method: access.method, outcome } } };
  },
});

const requestDigitalAccessPipeline = createAction({
  name: "asset.digital.access.request",
  input: z.object({ assetId: z.uuid(), level: z.enum(ACCESS_LEVELS), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const asset = await findDigitalAsset(input.assetId);
    return !!asset && canRequestDigitalAccess(user.principal, asset);
  },
  run: async ({ user, input }) => {
    const { access, asset } = await requestDigitalAccess(input, user.person.id);
    refresh(asset.id);
    return { data: { id: access.id }, audit: { resource: { type: "digital_asset_access", id: access.id, entityId: asset.entityId }, summary: asset.name, after: { level: access.level, status: access.status } } };
  },
});

const decideDigitalAccessPipeline = createAction({
  name: "asset.digital.access.decide",
  input: z.object({ accessId: z.uuid(), decision: z.enum(["approve", "decline"]), level: optional(z.enum(ACCESS_LEVELS)), method: optional(z.enum(ACCESS_METHODS)), expiresOn: optional(isoDate), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const found = await findDigitalAccess(input.accessId);
    return !!found && canRunDigitalAsset(user.principal, found.asset);
  },
  run: async ({ user, input }) => {
    const { before, after, asset } = await decideDigitalAccess(input, user.person.id);
    refresh(asset.id);
    return { data: { status: after.status }, audit: { resource: { type: "digital_asset_access", id: after.id, entityId: asset.entityId }, summary: asset.name, before: { status: before.status, level: before.level }, after: { status: after.status, level: after.level } } };
  },
});

const endDigitalAccessPipeline = createAction({
  name: "asset.digital.access.end",
  input: z.object({ accessId: z.uuid(), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const found = await findDigitalAccess(input.accessId);
    return !!found && canEndDigitalAccess(user.principal, found.asset, found.access.personId);
  },
  run: async ({ user, input }) => {
    const { before, after, asset } = await endDigitalAccess(input.accessId, input.note, user.person.id);
    refresh(asset.id);
    revalidatePath("/today");
    return { data: { status: after.status }, audit: { resource: { type: "digital_asset_access", id: after.id, entityId: asset.entityId }, summary: asset.name, before: { status: before.status, personId: before.personId }, after: { status: after.status } } };
  },
});

const markCredentialsRotatedPipeline = createAction({
  name: "asset.digital.credentials_rotated",
  input: z.object({ assetId: z.uuid() }),
  authorize: async (user, input) => {
    const asset = await findDigitalAsset(input.assetId);
    return !!asset && canRunDigitalAsset(user.principal, asset);
  },
  run: async ({ input }) => {
    const { before, after } = await markCredentialsRotated(input.assetId);
    refresh(after.id);
    return { data: { id: after.id }, audit: { resource: { type: "digital_asset", id: after.id, entityId: after.entityId }, summary: after.name, before: { rotationDueSince: before.rotationDueSince }, after: { credentialsRotatedAt: after.credentialsRotatedAt } } };
  },
});

// A `"use server"` file may export nothing but async functions (tests/server-actions.test.ts).

export async function saveDigitalAssetAction(input: unknown) {
  return saveDigitalAssetPipeline(input);
}

export async function grantDigitalAccessAction(input: unknown) {
  return grantDigitalAccessPipeline(input);
}

export async function requestDigitalAccessAction(input: unknown) {
  return requestDigitalAccessPipeline(input);
}

export async function decideDigitalAccessAction(input: unknown) {
  return decideDigitalAccessPipeline(input);
}

export async function endDigitalAccessAction(input: unknown) {
  return endDigitalAccessPipeline(input);
}

export async function markCredentialsRotatedAction(input: unknown) {
  return markCredentialsRotatedPipeline(input);
}
