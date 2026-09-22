"use client";
// Review chains (FR-PJM-50): the ordered stages a version passes — who reviews each (a rule, or one
// person) and how long it may wait. A team's leads keep the team's chains; a project's lead its own.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { removeReviewChainAction, saveReviewChainAction } from "../delivery-actions";
import { MAX_CHAIN_STAGES, REVIEWER_RULES } from "../engine/delivery";
import { CONTENT_FORMATS } from "../enums";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

export type ChainView = { id: string; name: string; projectId: string | null; contentFormat: string | null; isActive: boolean; stages: { key: string; name: string; reviewer: string; dueHours: number | null }[] };
type Person = { id: string; fullName: string };

/** The reviewer of a stage in words: a rule's name, or the person's. */
export function useReviewerLabel(people: Person[]) {
  const t = useTranslations("work.chains");
  return (reviewer: string) => (reviewer.startsWith("person:") ? (people.find((person) => `person:${person.id}` === reviewer)?.fullName ?? t("rules.person")) : t.has(`rules.${reviewer}`) ? t(`rules.${reviewer}`) : reviewer);
}

export function ReviewChainManager({ teamId, projectId = null, chains, people, canManage }: { teamId: string; projectId?: string | null; chains: ChainView[]; people: Person[]; canManage: boolean }) {
  const t = useTranslations("work.chains");
  const tWork = useTranslations("work");
  const reviewerLabel = useReviewerLabel(people);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(projectId ? "projectHint" : "teamHint")}</p>
      {chains.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {chains.map((chain) => {
          const inherited = !!projectId && !chain.projectId;
          return (
            <li key={chain.id} className="rounded-xl border p-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium">{chain.name}</span>
                  {chain.contentFormat ? <Badge variant="secondary">{tWork(`formats.${chain.contentFormat}`)}</Badge> : <Badge variant="outline">{t("anyFormat")}</Badge>}
                  {inherited ? <Badge variant="outline">{t("fromTeam")}</Badge> : null}
                  {chain.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                  <span className="text-xs text-muted-foreground">{chain.stages.map((stage) => stage.name).join(" → ")}</span>
                </summary>
                <div className="pt-3">
                  {canManage && !inherited ? (
                    <ChainForm teamId={teamId} projectId={projectId} people={people} chain={chain} />
                  ) : (
                    <ol className="list-decimal pl-5">
                      {chain.stages.map((stage) => (
                        <li key={stage.key}>
                          {stage.name} — {reviewerLabel(stage.reviewer)}
                          {stage.dueHours ? ` · ${t("dueIn", { hours: stage.dueHours })}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("create")}</summary>
          <div className="pt-3">
            <ChainForm teamId={teamId} projectId={projectId} people={people} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

type StageDraft = { id: string; key: string | null; name: string; rule: string; personId: string; dueHours: string };
const newRowId = () => Math.random().toString(36).slice(2, 10);
const toDraft = (stage: ChainView["stages"][number]): StageDraft => ({ id: newRowId(), key: stage.key, name: stage.name, rule: stage.reviewer.startsWith("person:") ? "person" : stage.reviewer, personId: stage.reviewer.startsWith("person:") ? stage.reviewer.slice(7) : "", dueHours: stage.dueHours ? String(stage.dueHours) : "" });

function ChainForm({ teamId, projectId, people, chain }: { teamId: string; projectId: string | null; people: Person[]; chain?: ChainView }) {
  const t = useTranslations("work.chains");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [stages, setStages] = useState<StageDraft[]>(chain ? chain.stages.map(toDraft) : [{ id: newRowId(), key: null, name: t("defaults.lead"), rule: "team_lead", personId: "", dueHours: "24" }, { id: newRowId(), key: null, name: t("defaults.client"), rule: "client", personId: "", dueHours: "72" }]);
  const change = (id: string, patch: Partial<StageDraft>) => setStages((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const move = (index: number, by: number) =>
    setStages((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
  const run = (call: () => Promise<Result>, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorKeyOf(result));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(() =>
          saveReviewChainAction({
            chainId: chain?.id ?? "",
            teamId,
            projectId: projectId ?? "",
            name: data.get("name"),
            contentFormat: data.get("contentFormat"),
            isActive: data.get("isActive") === "on",
            stages: stages.map((stage) => ({ key: stage.key ?? "", name: stage.name, reviewer: stage.rule === "person" ? `person:${stage.personId}` : stage.rule, dueHours: stage.dueHours })),
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`chain-name-${chain?.id ?? "new"}`}>{t("name")}</Label>
          <Input id={`chain-name-${chain?.id ?? "new"}`} name="name" required maxLength={80} defaultValue={chain?.name ?? ""} placeholder={t("namePlaceholder")} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`chain-format-${chain?.id ?? "new"}`}>{t("contentFormat")}</Label>
          <Select id={`chain-format-${chain?.id ?? "new"}`} name="contentFormat" defaultValue={chain?.contentFormat ?? ""}>
            <option value="">{t("anyFormat")}</option>
            {CONTENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {tWork(`formats.${format}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("stages")}</legend>
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className="w-6 text-xs text-muted-foreground">{index + 1}.</span>
            <Input aria-label={t("stageName")} value={stage.name} maxLength={60} required onChange={(event) => change(stage.id, { name: event.target.value })} className="sm:w-44" placeholder={t("stageName")} />
            <Select aria-label={t("reviewer")} value={stage.rule} onChange={(event) => change(stage.id, { rule: event.target.value })} className="sm:w-48">
              {[...REVIEWER_RULES, "person"].map((rule) => (
                <option key={rule} value={rule}>
                  {t(`rules.${rule}`)}
                </option>
              ))}
            </Select>
            {stage.rule === "person" ? (
              <Select aria-label={t("rules.person")} value={stage.personId} required onChange={(event) => change(stage.id, { personId: event.target.value })} className="sm:w-48">
                <option value="">—</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            ) : null}
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input aria-label={t("dueHours")} type="number" inputMode="numeric" min={1} max={744} value={stage.dueHours} onChange={(event) => change(stage.id, { dueHours: event.target.value })} className="w-20" />
              {t("hours")}
            </label>
            <div className="flex gap-1 sm:ml-auto">
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("moveDown")} disabled={index === stages.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("removeStage")} disabled={stages.length === 1} onClick={() => setStages((rows) => rows.filter((row) => row.id !== stage.id))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="w-fit" disabled={stages.length >= MAX_CHAIN_STAGES} onClick={() => setStages((rows) => [...rows, { id: newRowId(), key: null, name: "", rule: "project_lead", personId: "", dueHours: "24" }])}>
          <Plus aria-hidden /> {t("addStage")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("clientLast")}</p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={chain?.isActive ?? true} className="size-4" /> {t("active")}
      </label>
      <DeliveryError errorKey={errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {chain ? tWork("save") : t("create")}
        </Button>
        {chain ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t("removeConfirm")) && run(() => removeReviewChainAction({ chainId: chain.id }))}>
            {t("remove")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
