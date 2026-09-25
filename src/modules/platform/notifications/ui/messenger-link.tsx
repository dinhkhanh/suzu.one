"use client";
import { confirmMessengerLinkAction, sendTestMessengerAction, startMessengerLinkAction, unlinkMessengerAction } from "../actions";
import { type ChatAppStatus, ChatAppLink } from "./chat-app-link";

const actions = { start: startMessengerLinkAction, confirm: confirmMessengerLinkAction, unlink: unlinkMessengerAction, test: sendTestMessengerAction };

/** "Get notifications on Messenger" (docs/MESSENGER.md). */
export function MessengerLink(props: { configured: boolean; status: ChatAppStatus }) {
  return <ChatAppLink namespace="notifications.messenger" actions={actions} {...props} />;
}
