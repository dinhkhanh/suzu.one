import "server-only";
import { env } from "@/lib/env";
import type { EmailAttachment } from "./schema";

export type OutgoingEmail = { to: string; subject: string; text: string; attachments?: readonly EmailAttachment[] | null };
export type SendResult = { status: "sent" } | { status: "skipped" } | { status: "failed"; error: string };

/** Hands one email to the provider (Resend). Without an API key nothing leaves the machine. */
export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const { RESEND_API_KEY: apiKey, EMAIL_FROM: from } = env();
  if (!apiKey) return { status: "skipped" };
  // Resend takes an attachment's bytes as base64 `content`, which is how the outbox stores them.
  const attachments = email.attachments?.length ? email.attachments.map((file) => ({ filename: file.fileName, content: file.contentBase64, content_type: file.contentType })) : undefined;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, ...(attachments ? { attachments } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { status: "sent" };
    return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
