"use client";
import { confirmTelegramLinkAction, sendTestTelegramAction, startTelegramLinkAction, unlinkTelegramAction } from "../actions";
import { type ChatAppStatus, ChatAppLink } from "./chat-app-link";

const actions = { start: startTelegramLinkAction, confirm: confirmTelegramLinkAction, unlink: unlinkTelegramAction, test: sendTestTelegramAction };

/** "Get notifications on Telegram" (docs/TELEGRAM.md). */
export function TelegramLink(props: { configured: boolean; status: ChatAppStatus }) {
  return <ChatAppLink namespace="notifications.telegram" actions={actions} {...props} />;
}
