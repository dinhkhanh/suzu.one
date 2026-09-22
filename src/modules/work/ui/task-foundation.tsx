"use client";
// The task page's Phase 10 panels: blockers (FR-PJM-28), moving to another team (FR-PJM-34) and
// the notice on work still waiting in triage (FR-PJM-32).
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDuration } from "../engine/custom-fields";
import { moveTaskAction, raiseBlockerAction, resolveBlockerAction } from "../foundation-actions";

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = <R extends Result>(call: () => Promise<R>, after?: (result: R) => void) =>
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

export type BlockerItem = { id: string; reason: string; neededName: string | null; raisedByName: string | null; raisedAt: string; resolvedAt: string | null; resolvedByName: string | null; resolution: string | null; minutes: number };

/** "Mark blocked" with a reason and who can unblock it; "Resolve" with a note; the history below. */
export function BlockerPanel({ taskId, blockers, people, canRaise, canResolve, closed }: { taskId: string; blockers: BlockerItem[]; people: { id: string; fullName: string }[]; canRaise: boolean; canResolve: boolean; closed: boolean }) {
  const t = useTranslations("work.blockers");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const [raising, setRaising] = useState(false);
  const open = blockers.find((blocker) => !blocker.resolvedAt);
  const past = blockers.filter((blocker) => blocker.resolvedAt);
  const total = blockers.reduce((sum, blocker) => sum + blocker.minutes, 0);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      {open ? (
        <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{t("open", { reason: open.reason })}</p>
          <p className="text-xs text-muted-foreground">{[open.neededName ? t("waitingOn", { name: open.neededName }) : null, t("raisedBy", { name: open.raisedByName ?? "—", date: when(open.raisedAt) }), t("blockedFor", { duration: formatDuration(open.minutes) })].filter(Boolean).join(" · ")}</p>
          {canResolve ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(() => resolveBlockerAction({ taskId, resolution: data.get("resolution") }));
              }}
            >
              <Input name="resolution" maxLength={500} placeholder={t("resolution")} aria-label={t("resolution")} className="min-w-0 flex-1" />
              <Button type="submit" size="sm" disabled={pending}>
                {t("resolve")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : canRaise && !closed ? (
        raising ? (
          <form
            className="flex flex-col gap-2 rounded-xl border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => raiseBlockerAction({ taskId, reason: data.get("reason"), neededPersonId: data.get("neededPersonId") }), () => setRaising(false));
            }}
          >
            <Label htmlFor="blocker-reason">{t("reason")}</Label>
            <Input id="blocker-reason" name="reason" required maxLength={500} placeholder={t("reasonPlaceholder")} autoFocus />
            <Label htmlFor="blocker-needed">{t("needed")}</Label>
            <Select id="blocker-needed" name="neededPersonId" defaultValue="">
              <option value="">{t("nobody")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                {t("raise")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRaising(false)}>
                ×
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="self-start" onClick={() => setRaising(true)}>
            {t("markBlocked")}
          </Button>
        )
      ) : blockers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}
      <ErrorLine errorKey={errorKey} />
      {past.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("history")} ({past.length}) · {t("total", { duration: formatDuration(total) })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {past.map((blocker) => (
              <li key={blocker.id} className="flex flex-col text-xs">
                <span className="font-medium">{blocker.reason}</span>
                <span className="text-muted-foreground">{[t("raisedBy", { name: blocker.raisedByName ?? "—", date: when(blocker.raisedAt) }), t("resolvedBy", { name: blocker.resolvedByName ?? "—", date: when(blocker.resolvedAt!) }), t("blockedFor", { duration: formatDuration(blocker.minutes) }), blocker.resolution].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** Move to another team: pick the team and, optionally, one of its projects. */
export function MovePanel({ taskId, taskKey, teams }: { taskId: string; taskKey: string; teams: { id: string; name: string; key: string; backlog: boolean; projects: { id: string; name: string }[] }[] }) {
  const t = useTranslations("work.move");
  const router = useRouter();
  const { run, pending, errorKey } = useRun();
  const [teamId, setTeamId] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const team = teams.find((row) => row.id === teamId);
  if (teams.length === 0) return null;
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("title")}</summary>
      <form
        className="flex flex-col gap-2 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!team || !window.confirm(t("confirm", { key: taskKey, team: team.name }))) return;
          const projectId = new FormData(event.currentTarget).get("projectId");
          run(
            () => moveTaskAction({ taskId, teamId, projectId }),
            (result) => {
              const key = (result as Result & { data?: { key: string } }).data?.key ?? "";
              setDone(key);
              router.refresh();
            },
          );
        }}
      >
        <p className="text-xs text-muted-foreground">{t("description")}</p>
        <Label htmlFor="move-team">{t("team")}</Label>
        <Select id="move-team" value={teamId} onChange={(event) => setTeamId(event.target.value)} required>
          <option value="" disabled>
            {t("chooseTeam")}
          </option>
          {teams.map((row) => (
            <option key={row.id} value={row.id}>
              {row.key} · {row.name}
            </option>
          ))}
        </Select>
        {team ? (
          <>
            <Label htmlFor="move-project">{t("project")}</Label>
            <Select id="move-project" name="projectId" defaultValue={team.backlog ? "" : team.projects[0]?.id} key={team.id}>
              {team.backlog ? <option value="">{t("noProject")}</option> : null}
              {team.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending || !team}>
          {t("submit")}
        </Button>
        {done ? <p className="text-sm text-muted-foreground">{t("done", { key: done })}</p> : null}
        <ErrorLine errorKey={errorKey} />
      </form>
    </details>
  );
}

/** Above a task still in triage: it is not the team's work yet. */
export function TriageBanner({ teamId, status, until }: { teamId: string; status: string; until: string | null }) {
  const t = useTranslations("work.triage");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <Badge variant="warning">{status === "snoozed" && until ? t("until", { date: until.split("-").reverse().join("/") }) : t("title")}</Badge>
      <span>{t("banner")}</span>
      <Link href={`/work/teams/${teamId}/triage`} className="underline">
        {t("bannerLink")}
      </Link>
    </div>
  );
}
