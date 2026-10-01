"use client";
// "Edit" and "Archive" beside a team's or a project's name: the same forms as before, opened where they are found.
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ComponentProps, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { setProjectArchivedAction, setTeamArchivedAction } from "../actions";
import { PosterEditor } from "./poster-editor";
import { ProjectForm } from "./project-forms";
import { TeamForm } from "./team-forms";

function EditDialog({ label, title, children }: { label: string; title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PencilIcon />
        {label}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

export function EditTeamButton(props: Omit<ComponentProps<typeof TeamForm>, "onSaved"> & { team: NonNullable<ComponentProps<typeof TeamForm>["team"]> }) {
  const t = useTranslations("work.teams");
  return <EditDialog label={t("edit")} title={t("editTitle", { name: props.team.name })}>{(close) => <TeamForm {...props} onSaved={close} />}</EditDialog>;
}

export function EditProjectButton(props: Omit<ComponentProps<typeof ProjectForm>, "onSaved" | "teams"> & { project: NonNullable<ComponentProps<typeof ProjectForm>["project"]> & { posterFileId: string | null } }) {
  const t = useTranslations("work.projects");
  return (
    <EditDialog label={t("edit")} title={t("editTitle", { name: props.project.name })}>
      {(close) => (
        <>
          <PosterEditor project={props.project} />
          <ProjectForm {...props} teams={[]} onSaved={close} />
        </>
      )}
    </EditDialog>
  );
}

/**
 * Archive a team or a project — asked first, it leaves the working lists — or bring it back,
 * which needs no asking.
 */
export function ArchiveButton({ target, name, archived }: { target: { teamId: string } | { projectId: string }; name: string; archived: boolean }) {
  const t = useTranslations("work.archive");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const kind = "teamId" in target ? "team" : "project";
  const run = (next: boolean) =>
    startTransition(async () => {
      const result = "teamId" in target ? await setTeamArchivedAction({ ...target, archived: next }) : await setProjectArchivedAction({ ...target, archived: next });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (!result.ok) return;
      setOpen(false);
      router.refresh();
    });
  if (archived)
    return (
      <span className="flex flex-col items-end gap-1">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(false)}>
          <ArchiveRestoreIcon />
          {t("restore")}
        </Button>
        <FormError namespace="work.errors" errorKey={errorKey} />
      </span>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ArchiveIcon />
        {t("archive")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("confirmTitle", { name })}</DialogTitle>
          <DialogDescription>{t(`confirm.${kind}`)}</DialogDescription>
        </DialogHeader>
        <FormError namespace="work.errors" errorKey={errorKey} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("cancel")}</DialogClose>
          <Button disabled={pending} onClick={() => run(true)}>
            <ArchiveIcon />
            {t("archive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
