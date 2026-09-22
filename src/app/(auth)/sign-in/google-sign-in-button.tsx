"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/platform/auth/client";

export function GoogleSignInButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/today",
      errorCallbackURL: "/sign-in",
    });
    if (error) {
      setPending(false);
      router.replace(`/sign-in?error=${encodeURIComponent(error.message ?? "generic")}`);
    }
  }

  return (
    <Button size="lg" className="w-full" onClick={signIn} disabled={pending}>
      {label}
    </Button>
  );
}
