# Notifications on Telegram

A Telegram bot is a phone channel beside web push and Messenger (`docs/MESSENGER.md`). It
delivers the same notifications, to the Telegram account each person has proved is theirs.
Unlike Messenger it needs no app review, and a bot may write to anyone who pressed Start, at any
time. There's no 24-hour window and no template.

## What decides who gets a message

The design is Messenger's, adapted to Telegram:

1. **Two-sided linking** (`telegram-links.ts`).
   - The signed-in person clicks *Connect Telegram*. The app mints a one-time token (32 random
     bytes, stored as a SHA-256 hash, valid 15 minutes) and opens `t.me/<bot>?start=link_<token>`.
   - Pressing Start sends `/start link_<token>` to the webhook. The **first** chat to present a
     live token owns the attempt, and the bot sends it a six-digit code (hashed at rest, valid 10
     minutes). Any other chat gets "link no longer valid".
   - The person types the code into the app. Only the caller's own attempt is checked. Five wrong
     codes end it.

   A leaked link gives the finder a code in *their* Telegram, which they can't type into anyone
   else's session. The bot's replies never name the person.

2. **Private chats only** (`parseUpdate`). Anyone can add a bot to a group. A connect link pressed
   there would send one person's notifications to everyone in it. Updates from groups, supergroups
   and channels are ignored, as are messages from bots and any chat that isn't the sender's own
   (`chat.id` must equal `from.id`).

3. **One live link per person and per chat**, enforced by partial unique indexes. Relinking
   revokes the older link ("replaced").

4. **A security notice on every link** (`security.telegram_linked`, a mandatory category), by
   email and in the app.

5. **Every message is checked again at send time** (`telegram-outbox.ts`). A queued row names a
   *link*, not a chat. Just before sending, the deliverer re-reads the link and the person. The
   message is dropped unsent if the link was revoked or replaced, belongs to someone else, or the
   person is suspended or offboarded. The reason is recorded in `telegram_delivery.last_error`.

6. **Webhook authenticity** (`api/telegram/webhook`). `pnpm telegram:setup` registers a secret
   with Telegram, which sends it back in `X-Telegram-Bot-Api-Secret-Token` on every call. It is
   compared in constant time, and anything without it is refused before it is parsed. The webhook
   accepts only `message` updates. The bot token sits in the Bot API's URL path, so it is scrubbed
   from every recorded error.

7. **Ways out.** *Unlink* in the app. Sending `/stop` (or `dừng`, `hủy`) to the bot. Telegram
   reporting the chat gone (blocked bot, deleted account) revokes the link automatically.

## What a message contains

Telegram bot chats aren't end-to-end encrypted: Telegram can read them. The same per-category
rule as Messenger applies (`thirdParty` in `kinds.ts`). Security, HR, payroll, performance and
recruitment send only "Bạn có thông báo mới: *category*". Everything else sends the title and the
line, as on the lock screen.

Every message is sent:
- as plain text, with no parse mode, so nothing in a title can be read as markup;
- without link previews;
- with **`protect_content`**, so Telegram won't let it be forwarded or saved;
- with one button that opens a page **of this app**, which needs sign-in.

The one-shot approve links are never sent. The bot never answers questions with data.

Telegram follows each person's **Push** column in their notification preferences, like web push
and Messenger. A person may link Telegram, Messenger, or both.

## Setting it up

1. In Telegram, talk to **@BotFather**: `/newbot`, pick a name and a username (ending in `bot`).
   Keep the token it gives you secret.
2. **Environment** (Vercel, `.env.local`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without
   the @), `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`).
3. Deploy, then run `pnpm telegram:setup` with the production `BETTER_AUTH_URL`. It checks the
   token matches the username, registers `https://<app domain>/api/telegram/webhook` with the
   secret, and sets the bot's description and its `/stop` command. The webhook is served on the
   app's domain only, never on `PUBLIC_SITE_URL`.
4. Optional, in @BotFather: `/setjoingroups` → **Disable**, so the bot can't be added to groups at
   all. The webhook already ignores groups; this closes the door as well.
5. In the app: **Notifications → Connect Telegram → Send a test.**

With any of the three variables unset, the local driver records every message as `simulated` and
nothing leaves the machine.

## Limits worth knowing

- The proof is "this person controls this Telegram account right now". If an employee's Telegram
  account is compromised, the attacker gets that person's notices. The generic categories keep the
  worst of that out of Telegram.
- `protect_content` stops forwarding and saving inside Telegram's apps. It doesn't stop a
  photograph of the screen.
