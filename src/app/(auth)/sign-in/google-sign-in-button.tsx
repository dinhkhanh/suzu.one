"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/platform/auth/client";

// Google's four-colour "G", the one mark on the page that is not ours.
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l3.9-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.5l3.9 3.1c1-2.8 3.6-4.8 6.7-4.8z" />
    </svg>
  );
}

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
    <Button size="lg" variant="outline" className="w-full" onClick={signIn} disabled={pending}>
      <GoogleMark />
      {label}
    </Button>
  );
}
