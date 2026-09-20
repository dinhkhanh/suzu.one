import "server-only";
import { env } from "@/lib/env";

export type OutgoingEmail = { to: string; subject: string; text: string };
export type SendResult = { status: "sent" } | { status: "skipped" } | { status: "failed"; error: string };

/** Hands one email to the provider (Resend). Without an API key nothing leaves the machine. */
export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const { RESEND_API_KEY: apiKey, EMAIL_FROM: from } = env();
  if (!apiKey) return { status: "skipped" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { status: "sent" };
    return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
