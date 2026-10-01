"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { List, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { markNotificationsReadAction, saveNotificationPreferencesAction } from "../actions";
import { CATEGORIES, CATEGORY_DEFINITIONS, type Category, type ChannelChoice, EMAIL_CHANNELS } from "../kinds";

/** Marks the notification read, then goes where it points. A small bare key at the row's end. */
export function OpenNotificationButton({ id, link, label, unread }: { id: string; link: string | null; label: string; unread: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={unread ? "text-link" : undefined}
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
      <Button type="submit" variant="outline" disabled={pending}>
        {t("markAllRead")}
      </Button>
    </form>
  );
}

/** Which channel carries each category: a row per category on the grid, the save key under it. */
export function PreferencesForm({ preferences }: { preferences: Record<Category, ChannelChoice> }) {
  const t = useTranslations("notifications.preferences");
  const { onSubmit, pending, errorKey, saved } = useActionForm(saveNotificationPreferencesAction);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <TableCard>
        <TableCardHeader title={t("title")} />
        <List>
          {CATEGORIES.map((category) => {
            const locked = CATEGORY_DEFINITIONS[category].mandatory;
            return (
              <ListItem key={category}>
                <fieldset disabled={locked} className="flex min-w-0 flex-1 flex-col gap-2.5 py-1 sm:flex-row sm:items-center sm:gap-4">
                  <legend className="contents">
                    <span className="min-w-0 flex-1 text-sm">
                      {t(`category.${category}`)}
                      {locked ? <span className="block text-xs text-muted-foreground">{t("mandatory")}</span> : null}
                    </span>
                  </legend>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name={`choices.${category}.inApp`} defaultChecked={preferences[category].inApp} />
                      {t("inApp")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name={`choices.${category}.push`} defaultChecked={preferences[category].push} />
                      {t("push")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      {t("email")}
                      <Select name={`choices.${category}.email`} defaultValue={preferences[category].email} aria-label={t("email")} className="w-auto">
                        {EMAIL_CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>
                            {t(`channel.${channel}`)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                </fieldset>
              </ListItem>
            );
          })}
        </List>
      </TableCard>
      <FormError namespace="notifications.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="w-full md:w-auto">
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
