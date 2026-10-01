// A person as a small disc of initials, for a card or a cell that names an owner. No photo: the
// register knows names, not faces, and two letters are enough to tell owners apart at a glance.
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar size="sm" className={className} title={name} aria-label={name}>
      <AvatarFallback className="text-[0.625rem] font-medium">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}
