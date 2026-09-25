"use client";
// On every visit the shell makes sure this device is set up for web push, without anybody having
// to find the toggle on the notifications page:
//  - permission already granted but no subscription (a new browser profile, a lost one): it
//    subscribes quietly;
//  - a subscription registered for somebody else who used this browser: re-registered for the
//    person signed in now;
//  - permission never decided: a bar across the top asks, with a button — browsers show their
//    own permission prompt only in answer to a click, and never on a page load.
// "Later" keeps the bar away for a fortnight; a browser-level "block" ends it for good.
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isRegisteredFor, pushSupported, registerSubscription, subscribeDevice } from "./push-client";

const LATER_KEY = "suzu:push:later";
const LATER_DAYS = 14;

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(LATER_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(LATER_KEY, String(Date.now() + LATER_DAYS * 86_400_000));
  } catch {
    // Without storage the bar comes back next visit; that is the most it can do.
  }
}

export function PushPrompt({ vapidPublicKey, personId }: { vapidPublicKey: string | null; personId: string }) {
  const t = useTranslations("notifications.push");
  const [ask, setAsk] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!vapidPublicKey || !pushSupported() || snoozed()) return;
    if (window.location.pathname === "/preview" || window.location.pathname.startsWith("/preview/")) return;
    let cancelled = false;
    (async () => {
      const permission = Notification.permission;
      if (permission === "denied") return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        if (!isRegisteredFor(subscription, personId)) await registerSubscription(subscription, personId);
        return;
      }
      if (permission === "granted") {
        await subscribeDevice(vapidPublicKey, personId);
        return;
      }
      if (!cancelled) setAsk(true);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey, personId]);

  if (!ask || !vapidPublicKey) return null;

  function turnOn() {
    // The permission request is the first thing the click does: the browser ties its prompt to the gesture.
    startTransition(async () => {
      const permission = await Notification.requestPermission();
      if (permission === "granted") await subscribeDevice(vapidPublicKey!, personId);
      else if (permission === "default") snooze();
      setAsk(false);
    });
  }

  function later() {
    snooze();
    setAsk(false);
  }

  return (
    <Alert variant="info" icon={BellRing} className="rounded-none border-x-0 border-t-0">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t("promptTitle")}</span> <span className="text-muted-foreground">{t("promptBody")}</span>
      </span>
      <span className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={turnOn} disabled={pending}>
          {t("turnOn")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={later} disabled={pending}>
          {t("promptLater")}
        </Button>
      </span>
    </Alert>
  );
}
