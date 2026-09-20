// Web push behind an adapter (NFR-UX-01). Two drivers, chosen by configuration:
//  - "web-push": the real protocol (RFC 8030 + 8291 + 8292) when VAPID keys are set;
//  - "local": no keys → nothing leaves the machine; the delivery is recorded as "simulated" so the
//    demo and the tests can see what would have been sent.
import "server-only";
import { env } from "@/lib/env";
import { encryptPayload, type PushKeys, vapidAuthorization } from "./web-push";

export type PushTarget = { endpoint: string } & PushKeys;
export type PushMessage = { title: string; body: string; link: string | null; tag?: string };
export type PushResult = { status: "sent" } | { status: "simulated" } | { status: "gone" } | { status: "failed"; error: string };
export type PushDriver = { name: "web-push" | "local"; send: (target: PushTarget, message: PushMessage) => Promise<PushResult> };

const localDriver: PushDriver = { name: "local", send: async () => ({ status: "simulated" }) };

// Push services live at the browser vendors; an endpoint anywhere else (or on plain http) is not one.
const isPushEndpoint = (endpoint: string) => {
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
};

function webPushDriver(vapid: { publicKey: string; privateKey: string; subject: string }): PushDriver {
  return {
    name: "web-push",
    send: async (target, message) => {
      if (!isPushEndpoint(target.endpoint)) return { status: "failed", error: "endpoint is not https" };
      try {
        const body = encryptPayload(Buffer.from(JSON.stringify(message)), target);
        const response = await fetch(target.endpoint, {
          method: "POST",
          headers: { authorization: vapidAuthorization(target.endpoint, vapid), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" },
          body: new Uint8Array(body),
          // Never follow a redirect with the message in hand.
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404 || response.status === 410) return { status: "gone" };
        if (response.ok) return { status: "sent" };
        return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export function pushDriver(): PushDriver {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env();
  return publicKey && privateKey ? webPushDriver({ publicKey, privateKey, subject }) : localDriver;
}

/** What the browser needs to subscribe; null = push is not configured on this server. */
export const vapidPublicKey = (): string | null => env().VAPID_PUBLIC_KEY ?? null;
