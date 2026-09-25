# Notifications on Facebook Messenger

Web push does not always arrive: iOS drops the subscription when the home-screen app is removed,
browsers throttle background tabs, and some Android vendors kill the service worker. Messenger is
a second phone channel beside web push. It delivers the same notifications, to the Messenger
account each person has proved is theirs.

## What decides who gets a message

A Messenger bot sees only a **PSID**, Meta's Page-scoped ID for "somebody on Messenger". Nothing
about a PSID says which employee it is. The design rests on never guessing:

1. **Two-sided linking** (`messenger-links.ts`).
   - The signed-in person clicks *Connect Messenger*. The app mints a one-time token (32 random
     bytes, stored as a SHA-256 hash, valid 15 minutes) and opens `m.me/<page>?ref=<token>`.
   - Meta posts the token and the opener's PSID to our webhook. The call is signed with the app
     secret. The **first** PSID to present a live token owns the attempt. The bot sends that PSID a
     six-digit code (hashed at rest, valid 10 minutes). Any other PSID gets "link no longer valid".
   - The person types the code into the app. Only the caller's own attempt is checked. Five wrong
     codes end it.

   A leaked link (a screenshot, a shared screen) gives the finder a code in *their* Messenger,
   which they can't type into anyone else's session. At worst the real person has to start again.
   The bot's replies never name the person.

2. **One live link per person and per Messenger account.** Partial unique indexes enforce this.
   Linking an account already linked to someone else revokes the older link ("replaced").

3. **A security notice on every link** (`security.messenger_linked`, a mandatory category). It goes
   by email and in the app. If someone linked their own Messenger from an unlocked laptop, the
   account owner finds out.

4. **Every message is checked again at send time** (`messenger-outbox.ts`). A queued row names a
   *link*, not a PSID. Just before sending, the deliverer re-reads the link and the person. The
   message is dropped unsent if the link was revoked or replaced, belongs to someone else, or the
   person is suspended or offboarded. The drop reason is recorded in `messenger_delivery.last_error`.

5. **Webhook authenticity** (`api/messenger/webhook`). Every POST must carry a valid
   `X-Hub-Signature-256`, an HMAC-SHA256 of the raw body with the app secret, compared in constant
   time. Anything unsigned is refused before it is parsed. Entries for any other Page are ignored.
   Our own Graph calls carry `appsecret_proof`, and the token goes in a header, never in a URL.

6. **Ways out.** *Unlink* in the app. Typing `dừng` / `stop` / `hủy` to the bot. Meta reporting the
   account gone (blocked, deleted) revokes the link automatically.

## What a message contains

Unlike web push, which is encrypted for the device, a Page's messages can be read by Meta, and
they stay in a chat history. Each category in `kinds.ts` declares `thirdParty: "full" | "generic"` (shared with Telegram):

| Category | Messenger shows |
| --- | --- |
| approvals, tasks, attendance, daily, comms, kb, ops, projects, system, feedback | the title and the line, as on the lock screen |
| **security, hr, payroll, performance, recruit** | only "Bạn có thông báo mới: *category*" |

Every message carries one button that opens a page **of this app**, which needs sign-in. The
one-shot "approve" links sent to Google Chat are never sent to Messenger. The bot never answers
questions with data. To any other input it says what it is for.

Messenger follows each person's **Push** column in their notification preferences. Choosing
"on my phone" covers both web push and Messenger.

## Meta's 24-hour rule

A Page may send anything for 24 hours after the person last wrote to it. Opening the connect link
counts, and so does any message. The `ACCOUNT_UPDATE` / `CONFIRMED_EVENT_UPDATE` /
`POST_PURCHASE_UPDATE` tags have returned error 100 since **27 April 2026**. Outside the window,
the only compliant route is an approved **utility template**. The deliverer:

- uses a free-form message (with a button) if the link's `last_inbound_at` is under 23 hours old;
- otherwise uses the template `MESSENGER_UTILITY_TEMPLATE`, filled with the title (`{{1}}`) and
  the app path (the URL button's suffix);
- falls back to the template if Meta says the window closed earlier than our clock did.

With no template configured, messages outside the window fail and are retried up to five times.
They go through if the person writes to the Page before then.

## Setting it up

1. **A Facebook Page** for the company, and a **Meta app** (type *Business*) with the Messenger
   product. Link the Page and generate a **Page access token** (use a System User token from
   Business Manager, so it does not expire).
2. **Permissions**: `pages_messaging` and `page_utility_messaging`. Employees are not app
   testers, so both need **Advanced Access**: App Review plus business verification. Until then
   only people with a role on the app receive messages.
3. **Environment** (Vercel, `.env.local`): `MESSENGER_PAGE_ID`, `MESSENGER_PAGE_ACCESS_TOKEN`,
   `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN` (`openssl rand -hex 24`),
   `MESSENGER_PAGE_USERNAME`.
4. **Webhook**: in the app dashboard, callback URL `https://<app domain>/api/messenger/webhook`
   and the same verify token. It is served on the app's domain only, never on `PUBLIC_SITE_URL`.
5. `pnpm messenger:setup` subscribes the webhook fields, sets the Get Started button (a first
   conversation delivers the `ref` only through it) and creates the utility template. Once the
   template shows `APPROVED`, set `MESSENGER_UTILITY_TEMPLATE`.
6. In the app: **Notifications → Connect Messenger → Send a test.**

With the first four variables unset, the local driver records every message as `simulated` and
nothing leaves the machine.

## Limits worth knowing

- The proof is "this person controls this Messenger account right now". If an employee's Facebook
  account is compromised, the attacker gets that person's notices. The generic categories keep the
  worst of that out of Messenger.
- Messenger has a shared inbox for Page admins. The messages the Page sends appear there. Keep the
  Page's admin list short, which is another reason the sensitive categories send only generic text.
