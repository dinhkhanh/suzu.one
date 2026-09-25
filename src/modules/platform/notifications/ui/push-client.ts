// What the browser side of web push shares between the "notify me on this device" toggle and the
// prompt the shell shows on a visit: feature detection, subscribing this device with the server's
// VAPID key, and remembering which person the device's subscription was registered for.
import { subscribePushAction } from "../actions";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// A push endpoint belongs to whoever subscribed last on the device (service.ts). Two people who
// share a browser — the owner seeing the app as somebody else, a shared desk — would otherwise
// leave it pointing at the first of them for good, so the page remembers who registered it and
// re-registers when somebody else signs in.
const OWNER_KEY = "suzu:push:owner";

function readOwner(): { endpoint: string; personId: string } | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    return raw ? (JSON.parse(raw) as { endpoint: string; personId: string }) : null;
  } catch {
    return null;
  }
}

function writeOwner(owner: { endpoint: string; personId: string } | null): void {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Private mode, blocked storage: the next visit registers again, which is harmless.
  }
}

export const isRegisteredFor = (subscription: PushSubscription, personId: string): boolean => {
  const owner = readOwner();
  return owner?.endpoint === subscription.endpoint && owner.personId === personId;
};

export const forgetRegistration = (): void => writeOwner(null);

/** Tells the server about this device's subscription, for `personId`; false when the server refused. */
export async function registerSubscription(subscription: PushSubscription, personId: string): Promise<boolean> {
  const result = await subscribePushAction(subscription.toJSON());
  if (!result.ok) return false;
  writeOwner({ endpoint: subscription.endpoint, personId });
  return true;
}

/**
 * Subscribes this device (permission already granted) and registers it. Returns the subscription,
 * or null when the server would not take it — the browser subscription is dropped again then, so
 * the device does not sit "on" with nobody to send to it.
 */
export async function subscribeDevice(vapidPublicKey: string, personId: string): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
  if (await registerSubscription(subscription, personId)) return subscription;
  await subscription.unsubscribe().catch(() => undefined);
  forgetRegistration();
  return null;
}
