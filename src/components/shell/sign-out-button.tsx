"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/platform/auth/client";

/** `compact` is the sidebar's version: the icon alone, beside the person's name. */
export function SignOutButton({ label, compact = false }: { label: string; compact?: boolean }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size={compact ? "icon-sm" : "sm"}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      <LogOut />
      {compact ? null : label}
    </Button>
  );
}
