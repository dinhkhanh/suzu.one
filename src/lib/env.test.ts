import { expect, it } from "vitest";
import { r2EndpointFor } from "./env";

it("finds the R2 endpoint from the account, or from R2_ENDPOINT without a pasted bucket name", () => {
  const account = "0123456789abcdef0123456789abcdef";
  expect(r2EndpointFor({ CLOUDFLARE_ACCOUNT_ID: account, STORAGE_BUCKET: "suzu-private" })).toBe(`https://${account}.r2.cloudflarestorage.com`);
  expect(r2EndpointFor({ R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com/suzu-private`, CLOUDFLARE_ACCOUNT_ID: account, STORAGE_BUCKET: "suzu-private" })).toBe(`https://${account}.r2.cloudflarestorage.com`);
  expect(r2EndpointFor({ R2_ENDPOINT: `https://${account}.eu.r2.cloudflarestorage.com/`, STORAGE_BUCKET: "suzu-private" })).toBe(`https://${account}.eu.r2.cloudflarestorage.com`);
  expect(r2EndpointFor({ STORAGE_BUCKET: "suzu-private" })).toBeUndefined();
});
