import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/text";

/** Where a person's current picture is served (`/api/people/[id]/photo/[fileId]`); null without one. */
export const photoUrlOf = (person: { id: string; photoFileId: string | null | undefined }): string | null =>
  person.photoFileId ? `/api/people/${person.id}/photo/${person.photoFileId}` : null;

/** A person's profile picture, or their initials when they have none (FR-CHR-01). */
export function PersonAvatar({ person, size, className }: { person: { id: string; fullName: string; photoFileId: string | null | undefined }; size?: "sm" | "default" | "lg"; className?: string }) {
  const src = photoUrlOf(person);
  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt={person.fullName} /> : null}
      <AvatarFallback>{initialsOf(person.fullName)}</AvatarFallback>
    </Avatar>
  );
}
