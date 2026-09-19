"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { markNotificationsReadAction, saveNotificationPreferencesAction } from "../actions";
import { CATEGORIES, CATEGORY_DEFINITIONS, type Category, type ChannelChoice, EMAIL_CHANNELS } from "../kinds";

/** Marks the notification read, then goes where it points. */
export function OpenNotificationButton({ id, link, label }: { id: string; link: string | null; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationsReadAction({ id });
          if (link) router.push(link);
        })
      }
    >
      {label}
    </Button>
  );
}

export function MarkAllReadButton() {
  const t = useTranslations("notifications");
  const { onSubmit, pending } = useActionForm(markNotificationsReadAction, { extra: { id: null } });
  return (
    <form onSubmit={onSubmit}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("markAllRead")}
      </Button>
    </form>
  );
}

export function PreferencesForm({ preferences }: { preferences: Record<Category, ChannelChoice> }) {
  const t = useTranslations("notifications.preferences");
  const { onSubmit, pending, errorKey, saved } = useActionForm(saveNotificationPreferencesAction);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      <div className="flex flex-col divide-y">
        {CATEGORIES.map((category) => {
          const locked = CATEGORY_DEFINITIONS[category].mandatory;
          return (
            <fieldset key={category} disabled={locked} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <legend className="contents">
                <span className="text-sm">
                  {t(`category.${category}`)}
                  {locked ? <span className="block text-xs text-muted-foreground">{t("mandatory")}</span> : null}
                </span>
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`choices.${category}.inApp`} defaultChecked={preferences[category].inApp} className="size-4" />
                {t("inApp")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                {t("email")}
                <Select name={`choices.${category}.email`} defaultValue={preferences[category].email} aria-label={t("email")}>
                  {EMAIL_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`channel.${channel}`)}
                    </option>
                  ))}
                </Select>
              </label>
            </fieldset>
          );
        })}
      </div>
      <FormError namespace="notifications.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
