import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/text";

/** Where a project's current poster is served; null without one. */
export const posterUrlOf = (project: { id: string; posterFileId?: string | null }): string | null => (project.posterFileId ? `/api/work/projects/${project.id}/poster/${project.posterFileId}` : null);

/** A project's poster as a rounded square beside its name, or its initials when it has none. */
export function ProjectPoster({ project, size = "default", className }: { project: { id: string; name: string; posterFileId?: string | null }; size?: "sm" | "default" | "lg"; className?: string }) {
  const src = posterUrlOf(project);
  return (
    <Avatar size={size} className={cn("rounded-lg after:rounded-lg data-[size=lg]:size-14", className)}>
      {src ? <AvatarImage src={src} alt={project.name} className="rounded-lg" /> : null}
      <AvatarFallback className="rounded-lg">{initialsOf(project.name)}</AvatarFallback>
    </Avatar>
  );
}
