"use client";
// "Edit" beside a team's or a project's name: the same forms as before, opened where they are found.
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
