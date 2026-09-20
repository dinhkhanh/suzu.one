"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toSearchKey } from "@/lib/text";
import { createTaskAction } from "../actions";

type Hit = { id: string; key: string; title: string; status: string; projectName: string | null };
type Targets = { teams: { id: string; key: string; name: string; canFileInBacklog: boolean }[]; projects: { id: string; teamId: string; name: string }[] };
type Entry = { id: string; label: string; hint?: string; run: () => void };

const typingInField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Cmd/Ctrl+K: go anywhere, find a task, create one. "c" (outside a field) opens quick-create.
 * Lives in the app layout; `pages` are the navigation entries the viewer already has.
 */
export function CommandPalette({ pages, selfId }: { pages: { label: string; href: string }[]; selfId: string }) {
  const t = useTranslations("work.palette");
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "search" | "create">("closed");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [place, setPlace] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setMode("closed");
    setQuery("");
    setHits([]);
    setCursor(0);
    setErrorKey(null);
  }, []);

  const openCreate = useCallback(() => {
    setMode("create");
    if (!targets) {
      fetch("/api/work/targets")
        .then((response) => (response.ok ? response.json() : { teams: [], projects: [] }))
        .then((data: Targets) => {
          setTargets(data);
          // The project on screen first, else the first place the person can file in.
          const onScreen = /\/work\/projects\/([0-9a-f-]{36})/.exec(window.location.pathname)?.[1];
          const project = data.projects.find((row) => row.id === onScreen) ?? data.projects[0];
          setPlace(project ? `project:${project.id}` : data.teams.find((team) => team.canFileInBacklog) ? `team:${data.teams.find((team) => team.canFileInBacklog)!.id}` : "");
        })
        .catch(() => setTargets({ teams: [], projects: [] }));
    }
  }, [targets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMode((current) => (current === "closed" ? "search" : "closed"));
      } else if (event.key === "Escape") close();
      else if (event.key === "c" && !event.metaKey && !event.ctrlKey && !event.altKey && !typingInField(event.target)) {
        // A list on screen has its own quick-create row: use it, the filters there apply.
        const inline = document.querySelector<HTMLInputElement>("[data-quick-create]");
        event.preventDefault();
        if (inline) inline.focus();
        else openCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, openCreate]);

  useEffect(() => {
    if (mode !== "closed") input.current?.focus();
  }, [mode]);

  // Task search, debounced; stale answers are dropped.
  const searching = mode === "search" && query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/work/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((data: { hits: Hit[] }) => setHits(data.hits))
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, query]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const entries = useMemo<Entry[]>(() => {
    const words = toSearchKey(query).split(" ").filter(Boolean);
    const matching = pages.filter((page) => words.every((word) => toSearchKey(page.label).includes(word)));
    return [
      ...(searching ? hits : []).map((hit) => ({ id: hit.id, label: `${hit.key} ${hit.title}`, hint: hit.projectName ?? undefined, run: () => go(`/work/tasks/${hit.id}`) })),
      { id: "create", label: t("create"), hint: "C", run: openCreate },
      ...matching.map((page) => ({ id: page.href, label: page.label, hint: t("goTo"), run: () => go(page.href) })),
    ];
  }, [pages, hits, searching, query, t, go, openCreate]);

  if (mode === "closed") return null;

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const [kind, id] = place.split(":");
    const project = kind === "project" ? targets?.projects.find((row) => row.id === id) : undefined;
    const teamId = project?.teamId ?? id;
    if (!teamId) return;
    startTransition(async () => {
      const result = await createTaskAction({ teamId, ...(project ? { projectId: project.id } : {}), title: data.get("title"), dueDate: data.get("dueDate"), assigneePersonId: data.get("mine") === "on" ? selfId : "" });
      if (!result.ok) return setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
      go(`/work/tasks/${result.data.id}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={t("title")} onClick={(event) => (event.target === event.currentTarget ? close() : undefined)}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border bg-background shadow-xl">
        {mode === "search" ? (
          <>
            <Input
              ref={input}
              value={query}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="h-11 rounded-none border-0 border-b focus-visible:ring-0"
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
                event.preventDefault();
                if (event.key === "ArrowDown") setCursor((value) => Math.min(value + 1, entries.length - 1));
                else if (event.key === "ArrowUp") setCursor((value) => Math.max(value - 1, 0));
                else entries[cursor]?.run();
              }}
            />
            <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
              {entries.map((entry, index) => (
                <li key={entry.id} role="option" aria-selected={index === cursor}>
                  <button type="button" className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${index === cursor ? "bg-muted" : ""}`} onMouseEnter={() => setCursor(index)} onClick={entry.run}>
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.hint ? <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form onSubmit={submitCreate} className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-medium">{t("create")}</h2>
            <Input ref={input} name="title" required maxLength={200} placeholder={t("taskTitle")} aria-label={t("taskTitle")} />
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label={t("where")} value={place} onChange={(event) => setPlace(event.target.value)} required className="min-w-0 flex-1">
                {targets === null ? <option value="">{t("loading")}</option> : null}
                {targets?.projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {targets.teams.find((team) => team.id === project.teamId)?.key} · {project.name}
                  </option>
                ))}
                {targets?.teams
                  .filter((team) => team.canFileInBacklog)
                  .map((team) => (
                    <option key={team.id} value={`team:${team.id}`}>
                      {team.key} · {t("backlogOf", { team: team.name })}
                    </option>
                  ))}
              </Select>
              <Input name="dueDate" type="date" aria-label={t("dueDate")} className="w-40" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="mine" defaultChecked /> {t("assignMe")}
              </label>
            </div>
            {targets && !place ? <p className="text-sm text-muted-foreground">{t("nowhere")}</p> : null}
            {errorKey ? (
              <p role="alert" className="text-sm text-destructive">
                {t("failed")}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={close}>
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending || !place}>
                {t("createSubmit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
