"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { List, ListItem } from "@/components/ui/list";
import { MultiSelect, Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addDependencyAction,
  createTaskAction,
  deleteTaskAction,
  removeDependencyAction,
  updateTaskAction,
} from "../actions";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { CHANNELS, CONTENT_FORMATS, PRIORITIES } from "../enums";
import { useHandoffGate } from "./handoff";
import { LabelChip } from "./team-forms";

type Named = { id: string; name: string };
export type DetailTask = {
  id: string;
  key: string;
  teamId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  stateId: string;
  status: string;
  assigneePersonId: string | null;
  requesterName: string | null;
  createdByName: string | null;
  createdAt: string;
  priority: number | null;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  clientId: string | null;
  channel: string | null;
  contentFormat: string | null;
  labelIds: string[];
  collaboratorIds: string[];
  checklist: {
    id: string;
    text: string;
    done: boolean;
    checklistId?: string;
    checklistName?: string;
    linkUrl?: string;
  }[];
  links: { id: string; url: string; title: string | null }[];
  /** FR-PJM-10. */
  cycleId?: string | null;
};
export type DetailOptions = {
  states: { id: string; name: string; isActive: boolean }[];
  people: { id: string; fullName: string }[];
  labels: { id: string; name: string; color: string }[];
  clients: Named[];
  projects: Named[];
  /** Tasks that can be linked: the same project's (or backlog's) other tasks. */
  linkable: { id: string; key: string; title: string }[];
  /** The team's cycles a task may be planned in (FR-PJM-10); the task's own closed one is listed too. */
  cycles?: { id: string; label: string }[];
  /** The checklist library's active checklists, to add one by hand. */
  checklists?: { id: string; name: string }[];
  /** The checklists hooked to the task's current stage; `required` ones hold the task there until ticked. */
  stageChecklists?: { id: string; name: string; required: boolean }[];
};
export type DetailSubtask = {
  id: string;
  key: string;
  title: string;
  status: string;
  stateId: string;
  assigneeName: string | null;
  dueDate: string | null;
};
export type DetailLink = {
  dependencyId: string;
  id: string;
  key: string;
  title: string;
  status: string;
  relation: "blocks" | "blocked_by" | "relates";
};
export type DetailActivity = {
  id: string;
  type: string;
  field: string | null;
  fromValue: unknown;
  toValue: unknown;
  createdAt: string;
  actorName: string | null;
};

const newId = () => Math.random().toString(36).slice(2, 10);

/** `intercept`: a refusal the screen answers itself (the hand-off gate opens its sheet, FR-PJM-40). */
function useRun(
  intercept?: (result: {
    ok: boolean;
    error?: string;
    message?: string;
    details?: unknown;
  }) => boolean,
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (
    action: (input: unknown) => Promise<{
      ok: boolean;
      error?: string;
      message?: string;
      details?: unknown;
    }>,
    input: unknown,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await action(input);
      if (intercept?.(result)) {
        setErrorKey(null);
        return;
      }
      setErrorKey(
        result.ok
          ? null
          : ((result.error === "failed" ? result.message : result.error) ??
              "generic"),
      );
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

export function TaskDetailView({
  task,
  options,
  subtasks,
  linked,
  canEdit,
  canDelete,
  children,
}: {
  task: DetailTask;
  options: DetailOptions;
  subtasks: DetailSubtask[];
  linked: DetailLink[];
  canEdit: boolean;
  canDelete: boolean;
  /** Files and the conversation, under the task's own sections. */ children?: React.ReactNode;
}) {
  const t = useTranslations("work.task");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const gate = useHandoffGate();
  const { run, pending, errorKey } = useRun(gate.intercept);
  const [saved, setSaved] = useState(false);
  const subtaskInput = useRef<HTMLInputElement>(null);
  const update = (patch: Record<string, unknown>, after?: () => void) =>
    run(updateTaskAction, { taskId: task.id, ...patch }, after);

  function saveFields(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const hours = text("estimateHours");
    setSaved(false);
    update(
      {
        title: text("title"),
        description: text("description"),
        assigneePersonId: text("assigneePersonId"),
        priority: text("priority"),
        startDate: text("startDate"),
        dueDate: text("dueDate"),
        estimateMinutes: hours ? Math.round(Number(hours) * 60) : "",
        projectId: text("projectId"),
        clientId: text("clientId"),
        channel: text("channel"),
        contentFormat: text("contentFormat"),
        labelIds: data.getAll("labelIds").map(String),
        collaboratorIds: data.getAll("collaboratorIds").map(String),
      },
      () => setSaved(true),
    );
  }

  const select = (
    name: string,
    label: string,
    value: string | null,
    children: React.ReactNode,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select
        id={name}
        name={name}
        form="task-fields"
        defaultValue={value ?? ""}
        disabled={!canEdit}
      >
        {children}
      </Select>
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-8">
        {gate.sheet}
        {errorKey ? (
          <p role="alert" className="text-sm text-destructive">
            {tWork.has(`errors.${errorKey}`)
              ? tWork(`errors.${errorKey}`)
              : tWork("errors.generic")}
          </p>
        ) : null}
        <form
          id="task-fields"
          onSubmit={saveFields}
          className="flex flex-col gap-3"
        >
          <Input
            name="title"
            required
            maxLength={200}
            defaultValue={task.title}
            disabled={!canEdit}
            aria-label={t("fields.title")}
            className="h-auto text-lg font-semibold md:text-lg"
          />
{canEdit ? (
            <NoteEditor
              name="description"
              maxLength={10000}
              rows={5}
              defaultValue={task.description ?? ""}
              aria-label={t("fields.description")}
              placeholder={t("descriptionPlaceholder")}
            />
          ) : (
            <RichText text={task.description} />
          )}
        </form>

        <TaskChecklist
          items={task.checklist}
          library={options.checklists ?? []}
          stage={options.stageChecklists ?? []}
          canEdit={canEdit}
          pending={pending}
          update={update}
        />

        <TableCard>
          <TableCardHeader title={t("subtasks")} count={subtasks.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{tWork("table.key")}</TableHead>
                <TableHead kind="text">{tWork("table.title")}</TableHead>
                <TableHead kind="person">{t("fields.assignee")}</TableHead>
                <TableHead kind="status">{t("fields.state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subtasks.length === 0 ? <TableEmpty>{t("noSubtasks")}</TableEmpty> : null}
              {subtasks.map((subtask) => (
                <TableRow key={subtask.id}>
                  <TableCell kind="id">{subtask.key}</TableCell>
                  <TableCell className="max-w-80">
                    <Link
                      href={`/work/tasks/${subtask.id}`}
                      className={`block truncate hover:underline ${subtask.status === "done" || subtask.status === "cancelled" ? "text-muted-foreground line-through" : "font-medium"}`}
                    >
                      {subtask.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {subtask.assigneeName ?? t("unassigned")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {options.states.find(
                        (state) => state.id === subtask.stateId,
                      )?.name ?? subtask.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canEdit ? (
            <TableAddRow label={t("subtaskAdd")} open={subtasks.length === 0}>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = subtaskInput.current?.value.trim();
                    if (title)
                      run(
                        createTaskAction,
                        { teamId: task.teamId, parentTaskId: task.id, title },
                        () => (subtaskInput.current!.value = ""),
                      );
                  }}
                >
                  <Input
                    ref={subtaskInput}
                    maxLength={200}
                    placeholder={t("subtaskAdd")}
                    aria-label={t("subtaskAdd")}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                  >
                    {t("add")}
                  </Button>
                </form>
            </TableAddRow>
          ) : null}
        </TableCard>

        <TableCard>
          <TableCardHeader title={t("dependencies")} count={linked.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("relationLabel")}</TableHead>
                <TableHead kind="id">{tWork("table.key")}</TableHead>
                <TableHead kind="text">{tWork("table.title")}</TableHead>
                {canEdit ? <TableHead kind="actions" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.length === 0 ? <TableEmpty>{t("noDependencies")}</TableEmpty> : null}
              {linked.map((link) => (
                <TableRow key={link.dependencyId}>
                  <TableCell>
                    <Badge
                      variant={
                        link.relation === "blocked_by" &&
                        (link.status === "todo" || link.status === "in_progress")
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {t(`relation.${link.relation}`)}
                    </Badge>
                  </TableCell>
                  <TableCell kind="id">{link.key}</TableCell>
                  <TableCell className="max-w-80">
                    <Link
                      href={`/work/tasks/${link.id}`}
                      className={`block truncate hover:underline ${link.status === "done" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {link.title}
                    </Link>
                  </TableCell>
                  {canEdit ? (
                    <TableCell kind="actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          run(removeDependencyAction, {
                            dependencyId: link.dependencyId,
                          })
                        }
                      >
                        {t("remove")}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canEdit && options.linkable.length ? (
            <TableAddRow label={t("dependencyAdd")}>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    const [relation, other] = [
                      String(data.get("relation")),
                      String(data.get("otherTaskId")),
                    ];
                    if (!other) return;
                    const input =
                      relation === "blocks"
                        ? {
                            blockerTaskId: task.id,
                            blockedTaskId: other,
                            type: "blocks",
                          }
                        : {
                            blockerTaskId: other,
                            blockedTaskId: task.id,
                            type: relation === "relates" ? "relates" : "blocks",
                          };
                    run(addDependencyAction, input, () => form.reset());
                  }}
                >
                  <Select
                    name="relation"
                    aria-label={t("relationLabel")}
                    defaultValue="blocked_by"
                    className="w-40"
                  >
                    {(["blocked_by", "blocks", "relates"] as const).map(
                      (relation) => (
                        <option key={relation} value={relation}>
                          {t(`relation.${relation}`)}
                        </option>
                      ),
                    )}
                  </Select>
                  <Select
                    name="otherTaskId"
                    aria-label={t("otherTask")}
                    defaultValue=""
                    className="min-w-0 flex-1"
                  >
                    <option value="" disabled>
                      {t("otherTask")}
                    </option>
                    {options.linkable.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.key} {other.title}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                  >
                    {t("add")}
                  </Button>
                </form>
            </TableAddRow>
          ) : null}
        </TableCard>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("links")}
          </h2>
          <ul className="flex flex-col gap-1">
            {task.links.map((link) => (
              <li key={link.id} className="flex items-center gap-2 text-sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate underline"
                >
                  {link.title ?? link.url}
                </a>
                {canEdit ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    aria-label={t("remove")}
                    onClick={() =>
                      update({
                        links: task.links.filter((row) => row.id !== link.id),
                      })
                    }
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                update(
                  {
                    links: [
                      ...task.links,
                      {
                        id: newId(),
                        url: String(data.get("url")),
                        title: String(data.get("title") ?? ""),
                      },
                    ],
                  },
                  () => form.reset(),
                );
              }}
            >
              <Input
                name="url"
                type="url"
                required
                maxLength={1000}
                placeholder={t("linkUrl")}
                aria-label={t("linkUrl")}
                className="min-w-0 flex-1"
              />
              <Input
                name="title"
                maxLength={120}
                placeholder={t("linkTitle")}
                aria-label={t("linkTitle")}
                className="w-48"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={pending}
              >
                {t("add")}
              </Button>
            </form>
          ) : null}
        </section>

        {children}
      </div>

      <aside className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stateId">{t("fields.state")}</Label>
          <Select
            id="stateId"
            value={task.stateId}
            disabled={!canEdit || pending}
            onChange={(event) => update({ stateId: event.target.value })}
          >
            {options.states
              .filter((state) => state.isActive || state.id === task.stateId)
              .map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
          </Select>
        </div>
        {options.cycles?.length || task.cycleId ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cycleId">{tWork("cycles.field")}</Label>
            <Select
              id="cycleId"
              value={task.cycleId ?? ""}
              disabled={!canEdit || pending}
              onChange={(event) => update({ cycleId: event.target.value })}
            >
              <option value="">{tWork("cycles.noCycle")}</option>
              {(options.cycles ?? []).map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {/* The fields below belong to the form on the left (form="task-fields"), so one Save covers the title, the brief and these. */}
        {select(
          "assigneePersonId",
          t("fields.assignee"),
          task.assigneePersonId,
          <>
            <option value="">{t("unassigned")}</option>
            {options.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </>,
        )}
        {select(
          "priority",
          t("fields.priority"),
          task.priority ? String(task.priority) : null,
          <>
            <option value="">{tWork("priority.none")}</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {tWork(`priority.${priority}`)}
              </option>
            ))}
          </>,
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">{t("fields.startDate")}</Label>
            <DatePicker
              id="startDate"
              name="startDate"
              form="task-fields"
              defaultValue={task.startDate ?? ""}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dueDate">{t("fields.dueDate")}</Label>
            <DatePicker
              id="dueDate"
              name="dueDate"
              form="task-fields"
              defaultValue={task.dueDate ?? ""}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="estimateHours">{t("fields.estimateMinutes")}</Label>
          <Input
            id="estimateHours"
            name="estimateHours"
            type="number"
            min={0.25}
            max={1000}
            step={0.25}
            form="task-fields"
            defaultValue={task.estimateMinutes ? task.estimateMinutes / 60 : ""}
            disabled={!canEdit}
          />
        </div>
        {select(
          "projectId",
          t("fields.project"),
          task.projectId,
          <>
            <option value="">{t("noProject")}</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </>,
        )}
        {select(
          "clientId",
          t("fields.client"),
          task.clientId,
          <>
            <option value="">—</option>
            {options.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </>,
        )}
        {select(
          "channel",
          t("fields.channel"),
          task.channel,
          <>
            <option value="">—</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {tWork(`channels.${channel}`)}
              </option>
            ))}
          </>,
        )}
        {select(
          "contentFormat",
          t("fields.contentFormat"),
          task.contentFormat,
          <>
            <option value="">—</option>
            {CONTENT_FORMATS.map((value) => (
              <option key={value} value={value}>
                {tWork(`formats.${value}`)}
              </option>
            ))}
          </>,
        )}
        {options.labels.length ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t("fields.labels")}</Label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {options.labels.map((label) => (
                <label
                  key={label.id}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="labelIds"
                    value={label.id}
                    form="task-fields"
                    defaultChecked={task.labelIds.includes(label.id)}
                    disabled={!canEdit}
                  />
                  <LabelChip name={label.name} color={label.color} />
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="collaboratorIds">{t("fields.collaborators")}</Label>
          <MultiSelect
            id="collaboratorIds"
            name="collaboratorIds"
            form="task-fields"
            defaultValue={task.collaboratorIds}
            disabled={!canEdit}
          >
            {options.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </MultiSelect>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              form="task-fields"
              size="sm"
              disabled={pending}
            >
              {tWork("save")}
            </Button>
            {saved ? (
              <span className="text-sm text-muted-foreground">
                {tWork("saved")}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("meta", {
            requester: task.requesterName ?? "—",
            creator: task.createdByName ?? "—",
            date: format.dateTime(new Date(task.createdAt), {
              dateStyle: "medium",
            }),
          })}
        </p>
        {canDelete ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("deleteConfirm")))
                run(deleteTaskAction, { taskId: task.id }, () =>
                  router.push(
                    task.projectId
                      ? `/work/projects/${task.projectId}`
                      : "/work",
                  ),
                );
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
      </aside>
    </div>
  );
}

type ChecklistItem = DetailTask["checklist"][number];

/**
 * The task's tick-boxes: its own first, then each library checklist it carries under that
 * checklist's name. A copied box can be ticked, not reworded or taken out one by one; a whole
 * checklist can go — unless the stage the task is in requires it.
 */
function TaskChecklist({
  items,
  library,
  stage,
  canEdit,
  pending,
  update,
}: {
  items: ChecklistItem[];
  library: { id: string; name: string }[];
  stage: { id: string; name: string; required: boolean }[];
  canEdit: boolean;
  pending: boolean;
  update: (patch: Record<string, unknown>, after?: () => void) => void;
}) {
  const t = useTranslations("work.task");
  const [adding, setAdding] = useState("");
  const own = items.filter((item) => !item.checklistId);
  const groups = [
    ...new Set(
      items.flatMap((item) => (item.checklistId ? [item.checklistId] : [])),
    ),
  ].map((id) => ({
    id,
    items: items.filter((item) => item.checklistId === id),
  }));
  const carried = new Set(groups.map((group) => group.id));
  const required = new Set(
    stage.filter((hook) => hook.required).map((hook) => hook.id),
  );
  // A required checklist hooked to the stage after the task arrived: it still has to be added and ticked.
  const missing = stage.filter(
    (hook) => hook.required && !carried.has(hook.id),
  );
  const addable = library.filter((list) => !carried.has(list.id));
  const send = (next: ChecklistItem[], after?: () => void) =>
    update(
      { checklist: next.map(({ id, text, done }) => ({ id, text, done })) },
      after,
    );
  const toggle = (id: string) =>
    send(
      items.map((row) => (row.id === id ? { ...row, done: !row.done } : row)),
    );

  const box = (item: ChecklistItem, removable: boolean) => (
    <ListItem key={item.id} className="gap-2">
      <Checkbox
        checked={item.done}
        disabled={!canEdit || pending}
        onCheckedChange={() => toggle(item.id)}
        aria-label={item.text}
      />
      <span
        className={
          item.done ? "flex-1 text-muted-foreground line-through" : "flex-1"
        }
      >
        {item.text}
        {item.linkUrl ? (
          <a
            href={item.linkUrl}
            className="ml-2 text-xs text-muted-foreground underline underline-offset-2"
          >
            {t("checklistGuide")}
          </a>
        ) : null}
      </span>
      {canEdit && removable ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-destructive"
          disabled={pending}
          aria-label={t("remove")}
          onClick={() => send(items.filter((row) => row.id !== item.id))}
        >
          ×
        </button>
      ) : null}
    </ListItem>
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        {t("checklist")}
      </h2>
      {own.length ? <List>{own.map((item) => box(item, true))}</List> : null}
      {groups.map((group) => {
        const name =
          group.items[0].checklistName ??
          library.find((list) => list.id === group.id)?.name ??
          t("checklistFallback");
        const done = group.items.filter((item) => item.done).length;
        return (
          <TableCard key={group.id}>
            <TableCardHeader
              title={name}
              count={`${done}/${group.items.length}`}
              actions={
                required.has(group.id) || canEdit ? (
                  <>
                    {required.has(group.id) ? (
                      <Badge
                        variant={
                          done === group.items.length ? "secondary" : "outline"
                        }
                      >
                        {t("checklistRequired")}
                      </Badge>
                    ) : null}
                    {canEdit && !required.has(group.id) ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-destructive"
                        disabled={pending}
                        onClick={() =>
                          send(
                            items.filter((row) => row.checklistId !== group.id),
                          )
                        }
                      >
                        {t("checklistRemove")}
                      </button>
                    ) : null}
                  </>
                ) : null
              }
            />
            <List>{group.items.map((item) => box(item, false))}</List>
          </TableCard>
        );
      })}
      {missing.map((hook) => (
        <div
          key={hook.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5 text-sm"
        >
          <span className="flex-1">
            {t("checklistMissing", { name: hook.name })}
          </span>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => update({ addChecklistIds: [hook.id] })}
            >
              {t("checklistAddThis")}
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const text = String(new FormData(form).get("text") ?? "").trim();
              if (text)
                send([...items, { id: newId(), text, done: false }], () =>
                  form.reset(),
                );
            }}
          >
            <Input
              name="text"
              maxLength={200}
              placeholder={t("checklistAdd")}
              aria-label={t("checklistAdd")}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={pending}
            >
              {t("add")}
            </Button>
          </form>
          {addable.length ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (adding)
                  update({ addChecklistIds: [adding] }, () => setAdding(""));
              }}
            >
              <Select
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                aria-label={t("checklistFromLibrary")}
                className="w-full sm:w-56"
              >
                <option value="">{t("checklistFromLibrary")}</option>
                {addable.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={pending || !adding}
              >
                {t("add")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
