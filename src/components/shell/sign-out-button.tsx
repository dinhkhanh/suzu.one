"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import { authClient } from "@/modules/platform/auth/client";

/**
 * `compact` is the sidebar's version: the icon alone, beside the person's name. A page that puts
 * sign-out somewhere else (the phone's Me hub) passes its own `variant`, `size` and `className`.
 */
export function SignOutButton({ label, compact = false, variant = "ghost", size, className }: { label: string; compact?: boolean; className?: string } & Pick<VariantProps<typeof buttonVariants>, "variant" | "size">) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size={size ?? (compact ? "icon-sm" : "sm")}
      className={className}
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
