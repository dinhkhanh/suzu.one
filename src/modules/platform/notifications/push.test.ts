import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { generateVapidKeys } from "@/modules/platform/notifications/web-push";
const keys = generateVapidKeys();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:it@suzu.one" }) }));
import { pushDriver } from "@/modules/platform/notifications/push";
it("refuses plain http and reports an unreachable service as failed", async () => {
  const device = createECDH("prime256v1"); device.generateKeys();
  const target = { p256dh: device.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  expect(pushDriver().name).toBe("web-push");
  expect(await pushDriver().send({ endpoint: "http://127.0.0.1:9/x", ...target }, { title: "t", body: "b", link: null })).toEqual({ status: "failed", error: "endpoint is not https" });
  const result = await pushDriver().send({ endpoint: "https://127.0.0.1:9/x", ...target }, { title: "t", body: "b", link: null });
  expect(result.status).toBe("failed");
});
