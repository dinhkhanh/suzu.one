"use client";
// "Notify me on this device": asks the browser for permission, subscribes this device with the
// server's VAPID key and tells the server. Without a key on the server there is nothing to offer.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendTestPushAction, subscribePushAction, unsubscribePushAction } from "../actions";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

type State = "checking" | "unsupported" | "denied" | "off" | "on";

export function PushToggle({ vapidPublicKey, deviceCount }: { vapidPublicKey: string | null; /** Devices of this person the server knows, this one or others. */ deviceCount: number }) {
  const t = useTranslations("notifications.push");
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const registration = await navigator.serviceWorker.ready;
      return (await registration.pushManager.getSubscription()) ? ("on" as const) : ("off" as const);
    })().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function turnOn() {
    if (!vapidPublicKey) return;
    startTransition(async () => {
      setMessage(null);
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
      const result = await subscribePushAction(subscription.toJSON());
      if (!result.ok) {
        await subscription.unsubscribe();
        return setMessage(t("failed"));
      }
      setState("on");
      router.refresh();
    });
  }

  function turnOff() {
    startTransition(async () => {
      setMessage(null);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushAction({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("off");
      router.refresh();
    });
  }

  function test() {
    startTransition(async () => {
      const result = await sendTestPushAction({});
      setMessage(result.ok ? t(result.data.simulated > 0 ? "testSimulated" : "testSent", { count: result.data.devices }) : t("failed"));
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{!vapidPublicKey ? t("notConfigured") : state === "unsupported" ? t("unsupported") : state === "denied" ? t("denied") : state === "on" ? t("on") : t("off")}</p>
      <p className="text-xs text-muted-foreground">{t("devices", { count: deviceCount })}</p>
      <div className="flex flex-wrap items-center gap-2">
        {vapidPublicKey && state === "off" ? (
          <Button type="button" onClick={turnOn} disabled={pending}>
            {t("turnOn")}
          </Button>
        ) : null}
        {state === "on" ? (
          <Button type="button" variant="outline" onClick={turnOff} disabled={pending}>
            {t("turnOff")}
          </Button>
        ) : null}
        {deviceCount > 0 ? (
          <Button type="button" variant="outline" onClick={test} disabled={pending}>
            {t("test")}
          </Button>
        ) : null}
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </section>
  );
}
