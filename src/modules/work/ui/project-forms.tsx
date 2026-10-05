"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { createProjectAction, saveClientAction, updateProjectAction } from "../actions";
import { ColorSelect } from "./team-forms";
import { CLIENT_KINDS, PROJECT_STATUSES, VISIBILITIES } from "../enums";

type Option = { id: string; name: string };
type Project = { id: string; teamId: string; name: string; description: string | null; clientId: string | null; status: string; statusId: string | null; visibility: string; leadPersonId: string | null; startDate: string | null; dueDate: string | null; color: string | null };

export function ProjectForm({
  project,
  teams,
  clients,
  people,
  statuses = [],
  statusCategories,
  statusHint,
  onSaved,
}: {
  project?: Project;
  /** Teams the viewer may start a project in, with their default visibility. */
  teams: (Option & { defaultVisibility: string })[];
  clients: Option[];
  people: { id: string; fullName: string }[];
  /** The statuses of the team's set (`projectStatusChoices`); none = the categories. */
  statuses?: (Option & { category: string })[];
  /**
   * The status categories this project may be moved to by hand; absent = all. A page that knows the
   * project's gates (its kick-off, its close-out) passes them so the control does not offer what the
   * server would refuse; the server refuses either way.
   */
  statusCategories?: readonly string[];
  /** Said under the status control: where the statuses not offered are reached. */
  statusHint?: ReactNode;
  /** After an edit is saved — the dialog closes. */
  onSaved?: () => void;
}) {
  const offered = (category: string) => !statusCategories || statusCategories.includes(category);
  const t = useTranslations("work.projects");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(project ? updateProjectAction : createProjectAction, {
    extra: project ? { projectId: project.id } : {},
    onSuccess: (data) => {
      if (!project) return router.push(`/work/projects/${(data as { id: string }).id}`);
      router.refresh();
      onSaved?.();
    },
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="name" label={t("fields.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={project?.name} />
          </Field>
          {project ? null : (
            <Field name="teamId" label={t("fields.teamId")}>
              <Select id="teamId" name="teamId" required defaultValue={teams[0]?.id}>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field name="clientId" label={t("fields.clientId")}>
            <Select id="clientId" name="clientId" defaultValue={project?.clientId ?? ""}>
              <option value="">{t("internal")}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="visibility" label={t("fields.visibility")}>
            <Select id="visibility" name="visibility" defaultValue={project?.visibility ?? teams[0]?.defaultVisibility ?? "team"}>
              {VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {tWork(`visibility.${visibility}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="leadPersonId" label={t("fields.leadPersonId")}>
            <Select id="leadPersonId" name="leadPersonId" defaultValue={project?.leadPersonId ?? ""}>
              <option value="">{project ? "—" : t("leadMe")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          {project ? (
            <Field name="status" label={t("fields.status")}>
              {statuses.length ? (
                <Select id="status" name="status" defaultValue={project.statusId ?? statuses.find((status) => status.category === project.status)?.id ?? project.status}>
                  {statuses.some((status) => status.category === project.status) ? null : <option value={project.status}>{t(`status.${project.status as "active"}`)}</option>}
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id} disabled={!offered(status.category) && status.id !== project.statusId}>
                      {status.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select id="status" name="status" defaultValue={project.status}>
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status} disabled={!offered(status) && status !== project.status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </Select>
              )}
              {statusHint ? <p className="text-xs text-muted-foreground">{statusHint}</p> : null}
            </Field>
          ) : null}
          <Field name="color" label={t("fields.color")}>
            <ColorSelect id="color" name="color" defaultValue={project?.color ?? ""} none={t("teamColor")} />
          </Field>
          <Field name="startDate" label={t("fields.startDate")}>
            <DatePicker id="startDate" name="startDate" defaultValue={project?.startDate ?? ""} />
          </Field>
          <Field name="dueDate" label={t("fields.dueDate")}>
            <DatePicker id="dueDate" name="dueDate" defaultValue={project?.dueDate ?? ""} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="description" label={t("fields.description")}>
              <Input id="description" name="description" maxLength={2000} defaultValue={project?.description ?? ""} />
            </Field>
          </div>
        </div>
      </FieldErrors>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {project ? tWork("save") : t("create")}
        </Button>
        {saved && project ? <span className="text-sm text-muted-foreground">{tWork("saved")}</span> : null}
      </div>
    </form>
  );
}

type Client = { id: string; code: string; name: string; kind: string; parentId: string | null; entityId: string | null; note: string | null; isActive: boolean };

export function ClientForm({ client, parents, entities }: { client?: Client; /** Top-level clients a brand can belong to. */ parents: Option[]; entities: Option[] }) {
  const t = useTranslations("work.clients");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveClientAction, { extra: { clientId: client?.id ?? "" }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="name" label={t("fields.name")}>
            <Input id={`name-${client?.id ?? "new"}`} name="name" required maxLength={120} defaultValue={client?.name} />
          </Field>
          <Field name="code" label={t("fields.code")}>
            <Input id={`code-${client?.id ?? "new"}`} name="code" required maxLength={20} defaultValue={client?.code} className="uppercase" />
          </Field>
          <Field name="kind" label={t("fields.kind")}>
            <Select name="kind" defaultValue={client?.kind ?? "client"}>
              {CLIENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="parentId" label={t("fields.parentId")}>
            <Select name="parentId" defaultValue={client?.parentId ?? ""}>
              <option value="">—</option>
              {parents
                .filter((parent) => parent.id !== client?.id)
                .map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field name="entityId" label={t("fields.entityId")}>
            <Select name="entityId" defaultValue={client?.entityId ?? ""}>
              <option value="">{t("anyEntity")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="note" label={t("fields.note")}>
            <Input name="note" maxLength={1000} defaultValue={client?.note ?? ""} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={client?.isActive ?? true} /> {t("fields.isActive")}
          </label>
        </div>
      </FieldErrors>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {client ? tWork("save") : t("create")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{tWork("saved")}</span> : null}
      </div>
    </form>
  );
}
