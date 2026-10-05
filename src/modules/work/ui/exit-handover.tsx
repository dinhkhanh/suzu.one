"use client";
// Exit and transfer handover (FR-PJM-45): everything the person still owns, grouped, with bulk
// reassignment and one note; the offboarding step completes only when the list is empty. And the
// account handover of a client (FR-PJM-46), which needs the same note.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { heldKinds, isReassignable } from "../engine/exit";
import type { OwnedItemView } from "../exit";
import { changeAccountManagerAction, completeExitHandoverAction, reassignOwnershipAction } from "../handoff-actions";
import { HandoffNoteFields, readNote } from "./handoff";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<Result>, after?: (result: Result) => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.(result);
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("work");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

/** The page an owned item opens on, for the kinds that are a task or a project. */
const recordKindOf = (kind: string): "task" | "project" | null => (kind === "task" || kind === "review" ? "task" : kind === "project_lead" || kind === "account_manager" ? "project" : null);

export function ExitHandoverForm({ handoverId, owned, people, canRun, open }: { handoverId: string; owned: OwnedItemView[]; people: { id: string; fullName: string }[]; canRun: boolean; open: boolean }) {
  const t = useTranslations("work.exit");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const reassignable = owned.filter((item) => item.canReassign);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const keyOf = (item: OwnedItemView) => `${item.kind}:${item.id}`;
  // This module's kinds in their order, then those other modules list (the CRM's, FR-CRM-40).
  const groups = heldKinds(owned).map((kind) => ({ kind, items: owned.filter((item) => item.kind === kind) }));
  const toggle = (key: string, on: boolean) => setChosen((current) => new Set(on ? [...current, key] : [...current].filter((row) => row !== key)));
  // Work of a place this runner does not run has no name here: they are told whom to ask.
  const label = (item: OwnedItemView) => (item.label === null ? (item.ownerName ? t("privateItemAsk", { name: item.ownerName }) : t("privateItem")) : item.kind === "time_week" ? t("week", { date: format.dateTime(new Date(`${item.label}T00:00:00`), { dateStyle: "medium" }) }) : item.label);

  return (
    <div className="flex flex-col gap-4">
      {owned.length === 0 ? <p className="rounded-lg bg-muted p-3 text-sm">{t("clear")}</p> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const items = reassignable.filter((item) => chosen.has(keyOf(item))).map(({ kind, id }) => ({ kind, id }));
          const input = { handoverId, toPersonId: data.get("toPersonId"), items, note: readNote(data) };
          run(() => reassignOwnershipAction(input), () => setChosen(new Set()));
        }}
      >
        {groups.map((group) => (
          <TableCard key={group.kind}>
            <TableCardHeader
              title={t(`kinds.${group.kind}`)}
              count={group.items.length}
              actions={
                canRun && open && isReassignable(group.kind) ? (
                  <button type="button" className="text-xs font-normal underline" onClick={() => setChosen((current) => new Set([...current, ...group.items.filter((item) => item.canReassign).map(keyOf)]))}>
                    {t("selectAll")}
                  </button>
                ) : null
              }
            />
            <List>
              {group.items.map((item) => (
                <ListItem key={keyOf(item)} data-state={chosen.has(keyOf(item)) ? "selected" : undefined}>
                  {canRun && open && item.canReassign ? <Checkbox aria-label={label(item)} checked={chosen.has(keyOf(item))} onCheckedChange={(checked) => toggle(keyOf(item), checked)} /> : null}
                  <span className="min-w-0 flex-1 truncate">
                    {/* Named only where this runner runs the place, which is also where they may open it. */}
                    {item.label !== null && recordKindOf(item.kind) ? <RecordLink kind={recordKindOf(item.kind)!} id={item.id}>{label(item)}</RecordLink> : label(item)}
                  </span>
                  {item.context ? <span className="text-xs text-muted-foreground">{item.context}</span> : null}
                  {item.kind === "time_week" ? <span className="text-xs text-muted-foreground">{t("submitWeek")}</span> : null}
                </ListItem>
              ))}
            </List>
          </TableCard>
        ))}
        {canRun && open && reassignable.length ? (
          <Card size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exit-to">{t("reassignTo", { count: chosen.size })}</Label>
                <Select id="exit-to" name="toPersonId" required defaultValue="">
                  <option value="" disabled>
                    {t("pickPerson")}
                  </option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              </div>
              <HandoffNoteFields required />
              <ErrorLine errorKey={errorKey} />
              <Button type="submit" disabled={pending || chosen.size === 0} className="self-start">
                {t("reassign", { count: chosen.size })}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ErrorLine errorKey={errorKey} />
        )}
      </form>
      {canRun && open ? (
        <Button variant={owned.length === 0 ? "default" : "outline"} disabled={pending || owned.length > 0} onClick={() => run(() => completeExitHandoverAction({ handoverId }))} className="self-start">
          {owned.length === 0 ? t("complete") : t("completeBlocked", { count: owned.length })}
        </Button>
      ) : null}
    </div>
  );
}

/** FR-PJM-46: a new account manager for a client, with the note that tells them the relationship. */
export function AccountHandoverForm({ clientId, currentName, people }: { clientId: string; currentName: string | null; people: { id: string; fullName: string }[] }) {
  const t = useTranslations("work.handoff.account");
  const { run, pending, errorKey } = useRun();
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const [withheld, setWithheld] = useState(0);
  return (
    <Card size="sm">
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const input = { clientId, toPersonId: data.get("toPersonId"), note: readNote(data) };
            run(
              () => changeAccountManagerAction(input),
              (result) => {
                const data = result.data as { skipped: string[]; withheld: number };
                setSkipped(data.skipped);
                setWithheld(data.withheld);
                form.reset();
              },
            );
          }}
        >
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-xs text-muted-foreground">{currentName ? t("current", { name: currentName }) : t("none")}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`am-${clientId}`}>{t("to")}</Label>
            <Select id={`am-${clientId}`} name="toPersonId" required defaultValue="">
              <option value="" disabled>
                {t("pick")}
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
          </div>
          <HandoffNoteFields required />
          <ErrorLine errorKey={errorKey} />
          {skipped?.length ? <p className="text-sm text-muted-foreground">{t("skipped", { projects: skipped.join(", ") })}</p> : null}
          {withheld ? <p className="text-sm text-muted-foreground">{t("withheld", { count: withheld })}</p> : null}
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
