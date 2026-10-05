# SuZu One — the user interface

The look of the app, decided once (October 2026, "Quiet ink") and applied everywhere. Read this
before touching a page. The tokens and the shell live in `src/app/globals.css`; the primitives in
`src/components/ui/`; the shell in `src/components/shell/`.

## The idea

Paper ground, ink text, one accent. Hairlines, not boxes. Depth only on what floats (sheets,
menus, the palette). Motion that settles. The phone comes first: one thumb, a tab bar, sheets
that rise from the bottom; the desk is the same system with a sidebar and a mouse.

## Tokens (`globals.css`)

| Token | Light | Use |
| --- | --- | --- |
| `background` / `card` | white | the page, every sheet |
| `canvas` | paper `#FAFAF9` | the phone's ground behind cards, table headers, hover wash, the desk's sidebar tint (`sidebar`) |
| `muted` / `accent` | warm washes | chips, segmented tracks, secondary buttons, hover |
| `border` | `#E3E2DE` hairline | every frame; `input` a touch darker for fields |
| `foreground` / `ink` | `#1A1A1A` | text; `ink` is also the filled button (white at night) |
| `muted-foreground` | `#5C5C5C` | secondary text (4.5:1) |
| `faint` | `#737373` | captions, counts, placeholders (still 4.5:1 on white) |
| `primary` | blue `#3457D5` | **the one accent**: the hero action of a screen, focus ring, selection, active nav, unread dots |
| `success` / `warning` / `destructive` / `info` | tones | state, always tinted (`Badge`, `Alert`), never a fill |
| `tone-violet` / `tone-teal` / `tone-orange` / `tone-pink` / `tone-indigo` | hues | tell kinds apart, mean nothing |
| `brand` | red `#EA3026` | the mark only, ever |

Dark mode is the same tokens swapped (`@variant dark`); nothing else changes.

Type: **Be Vietnam Pro** (400/500/600/700) for everything, **JetBrains Mono** for keys, times,
money and counts (`font-mono tabular-nums`). Headings share one scale and pages set no size of
their own: `h1` 26/28px semibold tight (the page title), `h2` 17px, `h3` 15px. Section captions
are `.section-label` (11px uppercase tracked faint).

Radii: 10px controls (`rounded-[0.625rem]`), 14px cards and sheets (`rounded-[14px]`), 22px the
phone's bottom sheet, full for pills.

Motion: one easing `--ease-settle` (`cubic-bezier(.2,.8,.2,1)`), and `--ease-drawer`
(`cubic-bezier(.32,.72,0,1)`, iOS's sheet curve) for what a finger can hold — the phone's sheets and
menu drawer. 100ms hover/press, 200ms state, 300ms layers; what leaves goes faster than it came.
Every motion answers "why does this move?" — feedback, where a thing came from, or a change that
would otherwise jump — and how often it is seen decides how much it may move:

- `.press` on anything tappable (scales to 97%); a linked `ListItem` washes under the finger and
  stays washed until its page arrives, and a tapped tab stop or sidebar row takes the highlight at
  once (`LinkPending`, `components/shell/link-pending.tsx`) — the tap is answered before the server is.
- `.rise` + `style={{ "--i": index }}` on rows that should arrive one after another; the cascade
  stops at the tenth row.
- `Dialog` is Base UI's Drawer: on a phone a sheet that rises, follows the finger and is put away
  by a swipe or a flick; on a desk a card that settles in from 95% and ignores swipes. The phone's
  menu drawer swipes shut the same way (`use-swipe-to-close.ts`).
- Popovers, menus and selects grow from their trigger (`origin-(--transform-origin)`); dialogs grow
  from their own centre. `Collapsible` panels and every `<details>` open rather than appear.
- Counts pop when they arrive and when they change (`animate-pop`); scrims fade.
- Nothing a keyboard opens animates (the ⌘K palette on a desk), and nothing a reader is reading
  moves for style: figures, charts and timers change in place.
- `prefers-reduced-motion`: nothing travels, grows or springs and state changes are instant, but
  what arrives still fades in.

The app paints under the phone's notch and home indicator (`viewportFit: "cover"` in the app
layout) and pads its bars with `env(safe-area-inset-*)`. Inputs are 16px on a phone (`text-base
md:text-sm`) so iOS does not zoom into them.

## The shell (`components/shell/app-frame.tsx`)

- Desk: a 240px sidebar in `sidebar` tint, 28px rows, uppercase section captions, counts as
  accent pills; folds to a 56px rail. A 52px header with the breadcrumb, the feedback button and
  the bell. Content scrolls under it.
- Phone: no sidebar. A five-stop tab bar along the bottom (Today · Work · Inbox · Me · More) with
  a count on the shoulder of the stop that has something waiting; "More" slides the full menu in,
  its rows 44px in 15px type.
  A round ink "+" above the bar opens the quick-add sheet (task, time, leave, request).
- `⌘K` / the search field: the command palette (`modules/work/ui/command-palette.tsx`) — a sheet
  on a phone, a floating card on a desk. `C` creates a task.

## Building a page

```tsx
<Page width="default">            // narrow | default | wide | full
  <PageHeader eyebrow="Thứ Năm, 1 tháng 10" title={t("title")} description={…} actions={<Button>…</Button>} />
  <TileGrid>                      // key figures, 2 across on a phone
    <Tile label="…" value={<>8.5</>} hint="…" tone="warning" href="/leave" />
  </TileGrid>
  <Section title={t("planned")} count={5} action={<Link href="…">All</Link>}>
    <TableCard> … </TableCard>    // or <List>, or <Card>
  </Section>
</Page>
```

- `Page`, `PageHeader` (`eyebrow`, `description`, `actions`, and `aside` for a figure beside the title), `Section` (`count`, `action`, `description`), `Tile`, `TileGrid`: `components/ui/page.tsx`.
- Collections stay the reference grid (`Table` with a `kind` on every `TableHead`, `TableEmpty`,
  `TableAddRow`; `List` for feeds and rows that hold forms). Rows are 44px, headers 36px on paper,
  no vertical rules, a paper wash on hover. A table that does not fit a phone is wrapped by its
  container's `overflow-x-auto` — prefer giving the phone a `List` of the same rows when the
  screen is one people open on the go (Today, Inbox, Me, Leave, Requests).
- Two-to-four way switches are `Segmented` (`components/ui/segmented.tsx`; `size="sm"` inside a
  card, `stretch` on a phone); a row of page tabs is `.tab-row` (underlined, scrolls sideways on a
  phone). An on/off setting is `Switch`.
- Buttons: `default` is the ink key for the action the page is for; `accent` is the blue key for
  the **one** hero action of a screen (check out, send the request, submit the plan) — at most one
  per screen; `outline` and `secondary` for the rest; `destructive` is tinted, never filled; `ghost`
  for bare labels. Sizes grow on a phone by themselves (40px) and are 36px on a desk; `lg` is the
  48px thumb key at the bottom of a phone form.
- Badges are pills, tinted, `dot` for statuses; pick the variant with `statusTone()`.
- Forms: `Input`, `Textarea`, `Select`, `DatePicker` are 40px on a phone, 36px on a desk, with a
  3px accent ring on focus. Labels above fields. The submit key sits at the bottom, full width on
  a phone (`size="lg"` + `w-full md:w-auto`).
- Dialogs are bottom sheets on a phone (handle, rounded top, safe-area padding) and centred cards
  on a desk — `Dialog` does this by itself.
- A name is a way to its record. Wherever a person, project, client, task, team, asset or any
  other record with a page of its own is named — a table cell, a fact sheet, a byline, a history
  line, a sentence — it is a `RecordLink` (`components/ui/record-link.tsx`):
  `<RecordLink kind="person" id={row.ownerId}>{row.ownerName}</RecordLink>`. The routes live in
  `src/lib/record-routes.ts` (`recordHref(kind, id)` for an `href` prop); no hand-written
  `/people/${id}`. It is quiet (ink, underlined under the pointer) and takes the caller's classes,
  and it turns into plain text by itself when there is no id, when this viewer cannot open that
  kind (`linkableKinds` in `shell/nav.ts`) or inside a row that is already a link (`ListItem
  href`) — so pass `id={null}` when the page knows the viewer may not open this one record, and
  never put a link inside a link, a button, an option or a label. A query that shows a name selects
  the id beside it. Not linked: the record's own title on its own page, names inside form controls,
  and exports, e-mails and PDFs.
- Empty states are a row of the grid (`TableEmpty`, `ListEmpty`): one sentence, and when there is
  something to do about it, the add row under it.
- No hand-rolled `rounded-xl border` boxes, no `divide-y` lists, no raw `<table>`, no coloured
  left borders, no emoji, no second accent.

## Phone first

Write the phone layout, then widen: single column, `TileGrid` two across, tables that matter on
the go given a `List` alternative, actions stacked and full width, the hero action last and in
reach of the thumb. 44px targets. Nothing fixed to the top of the page but the shell's header.
Content gets `pb` for the tab bar from the shell; pages add none.
