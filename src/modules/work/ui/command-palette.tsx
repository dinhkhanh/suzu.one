"use client";
import { ArrowRight, CornerDownLeft, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PALETTE_CREATE_EVENT, PALETTE_EVENT } from "@/components/shell/palette-bus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { toSearchKey } from "@/lib/text";
import { cn } from "@/lib/utils";
import { createTaskAction } from "../actions";

type Hit = { id: string; key: string; title: string; status: string; projectName: string | null };
type Targets = { teams: { id: string; key: string; name: string; canFileInBacklog: boolean }[]; projects: { id: string; teamId: string; name: string }[] };
type Entry = { id: string; group: "tasks" | "actions" | "pages"; label: string; hint?: string; kbd?: string; run: () => void };

const typingInField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Cmd/Ctrl+K: go anywhere, find a task, create one. "c" (outside a field) opens quick-create, as
 * does the phone's quick-add sheet. Lives in the app layout; `pages` are the navigation entries
 * the viewer already has. A sheet on a phone, a floating card on a desk.
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

  // The sidebar's quick-actions button opens the same palette; the phone's quick-add sheet opens
  // it straight on the create form.
  useEffect(() => {
    const onOpen = () => setMode((current) => (current === "closed" ? "search" : current));
    window.addEventListener(PALETTE_EVENT, onOpen);
    window.addEventListener(PALETTE_CREATE_EVENT, openCreate);
    return () => {
      window.removeEventListener(PALETTE_EVENT, onOpen);
      window.removeEventListener(PALETTE_CREATE_EVENT, openCreate);
    };
  }, [openCreate]);

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
      ...(searching ? hits : []).map<Entry>((hit) => ({ id: hit.id, group: "tasks", label: `${hit.key} ${hit.title}`, hint: hit.projectName ?? undefined, run: () => go(`/work/tasks/${hit.id}`) })),
      { id: "create", group: "actions", label: t("create"), kbd: "C", run: openCreate },
      ...matching.map<Entry>((page) => ({ id: page.href, group: "pages", label: page.label, hint: t("goTo"), run: () => go(page.href) })),
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

  // Group headings appear where a group starts; the cursor runs over the flat list.
  const groupLabel: Record<Entry["group"], string> = { tasks: t("groups.tasks"), actions: t("groups.actions"), pages: t("groups.pages") };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 animate-fade sm:items-start sm:p-4 sm:pt-[14vh]" role="dialog" aria-modal="true" aria-label={t("title")} onClick={(event) => (event.target === event.currentTarget ? close() : undefined)}>
      <div className="flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-popover shadow-(--float-shadow) animate-in slide-in-from-bottom-full duration-300 ease-(--ease-settle) sm:max-w-xl sm:rounded-[14px] sm:slide-in-from-bottom-0 sm:zoom-in-95 sm:duration-150">
        {mode === "search" ? (
          <>
            <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-border px-4">
              <Search className="size-[1.125rem] shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={input}
                value={query}
                placeholder={t("placeholder")}
                aria-label={t("placeholder")}
                className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-faint"
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
              <kbd className="hidden rounded border border-border px-1.5 font-mono text-[0.625rem] text-faint sm:inline">esc</kbd>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox">
              {entries.map((entry, index) => (
                <li key={entry.id} role="option" aria-selected={index === cursor}>
                  {index === 0 || entries[index - 1].group !== entry.group ? <p className="section-label px-2.5 pt-2 pb-1">{groupLabel[entry.group]}</p> : null}
                  <button type="button" className={cn("flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] sm:h-9", index === cursor && "bg-muted")} onMouseEnter={() => setCursor(index)} onClick={entry.run}>
                    {entry.group === "actions" ? <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.hint ? <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span> : null}
                    {entry.kbd ? <kbd className="shrink-0 rounded border border-border px-1.5 font-mono text-[0.625rem] text-faint">{entry.kbd}</kbd> : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden h-9 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-faint sm:flex">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border px-1 font-mono text-[0.625rem]">↑↓</kbd> {t("hints.move")}
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" aria-hidden /> {t("hints.open")}
              </span>
            </div>
          </>
        ) : (
          <form onSubmit={submitCreate} className="flex flex-col gap-3 p-4 sm:p-5">
            <h2>{t("create")}</h2>
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
              <DatePicker name="dueDate" aria-label={t("dueDate")} className="w-40" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="mine" defaultChecked className="size-4 accent-primary" /> {t("assignMe")}
              </label>
            </div>
            {targets && !place ? <p className="text-sm text-muted-foreground">{t("nowhere")}</p> : null}
            {errorKey ? (
              <p role="alert" className="text-sm text-destructive">
                {t("failed")}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !place}>
                {t("createSubmit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
