"use client";
// Where a piece of work goes (FR-AST-09): the registered pages, channels and accounts a task or a
// project produces for. The asset itself — who owns it, who may get in — is the asset register's;
// these pieces name it, link to it, and say when the person doing the work cannot get into it.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { MultiSelect } from "@/components/ui/select";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { setProjectDigitalAssetsAction } from "../actions";

export type DigitalAssetChip = { id: string; name: string; platform: string; status?: string };

/** The assets as a row of chips, each a link to its page in the register. */
export function DigitalAssetChips({ assets }: { assets: DigitalAssetChip[] }) {
  const t = useTranslations("assets.digital.platform");
  if (assets.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {assets.map((asset) => (
        <Badge key={asset.id} variant="secondary" render={<Link href={`/assets/digital/${asset.id}`} />}>
          {t(asset.platform)} · {asset.name}
        </Badge>
      ))}
    </span>
  );
}

/**
 * A task's assets, one per row: what it is, and — when the task has an assignee who holds no access
 * to it — that the person doing the work cannot get in, with the way to ask.
 */
export function TaskDigitalAssets({ assets, assigneeName }: { assets: (DigitalAssetChip & { handle: string | null; url: string | null; assigneeHasAccess: boolean | null })[]; assigneeName: string | null }) {
  const t = useTranslations("work.digitalAssets");
  const tPlatform = useTranslations("assets.digital.platform");
  if (assets.length === 0) return null;
  return (
    <TableCard>
      <TableCardHeader title={t("title")} count={assets.length} />
      <List>
        {assets.map((asset) => (
          <ListItem key={asset.id} className="flex-wrap gap-x-3 gap-y-1">
            <Badge variant="secondary">{tPlatform(asset.platform)}</Badge>
            <Link href={`/assets/digital/${asset.id}`} className="min-w-0 truncate font-medium hover:underline">
              {asset.name}
            </Link>
            {asset.handle ? <span className="font-mono text-xs text-faint">{asset.handle}</span> : null}
            {asset.status === "retired" ? <Badge variant="outline">{t("retired")}</Badge> : null}
            {asset.assigneeHasAccess === false ? (
              <Badge variant="warning" className="ml-auto" render={<Link href={`/assets/digital/${asset.id}`} />}>
                {t("noAccess", { name: assigneeName ?? "" })}
              </Badge>
            ) : null}
          </ListItem>
        ))}
      </List>
    </TableCard>
  );
}

/** A project's assets: chips for everybody, and a picker for whoever runs the project. */
export function ProjectDigitalAssets({ projectId, linked, options, canManage }: { projectId: string; linked: DigitalAssetChip[]; options: DigitalAssetChip[]; canManage: boolean }) {
  const t = useTranslations("work.digitalAssets");
  const tWork = useTranslations("work");
  const tPlatform = useTranslations("assets.digital.platform");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(linked.map((asset) => asset.id));
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  if (!canManage) return linked.length ? <DigitalAssetChips assets={linked} /> : <p className="text-sm text-muted-foreground">{t("none")}</p>;
  // What is linked stays in the list even once retired, so saving does not silently drop it.
  const all = [...options, ...linked.filter((asset) => !options.some((option) => option.id === asset.id))];
  return (
    <div className="flex flex-col gap-2">
      <MultiSelect aria-label={t("title")} defaultValue={chosen} onValueChange={(values) => (setChosen(values), setState("idle"))}>
        {all.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name} · {tPlatform(asset.platform)}
          </option>
        ))}
      </MultiSelect>
      <p className="text-xs text-muted-foreground">{t("projectHint")}</p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setProjectDigitalAssetsAction({ projectId, digitalAssetIds: chosen });
              setState(result.ok ? "saved" : "failed");
              if (result.ok) router.refresh();
            })
          }
        >
          {tWork("save")}
        </Button>
        {state === "saved" ? <span className="text-sm text-muted-foreground">{tWork("saved")}</span> : null}
        {state === "failed" ? <span className="text-sm text-destructive">{tWork("errors.generic")}</span> : null}
      </div>
    </div>
  );
}
