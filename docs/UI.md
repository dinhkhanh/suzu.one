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

Motion: one easing `--ease-settle` (`cubic-bezier(.2,.8,.2,1)`); 100ms hover/press, 200ms state,
300ms layers. `.press` on anything tappable (scales to 97%). `.rise` + `style={{ "--i": index }}`
on rows that should arrive one after another. Sheets slide up (`animate-rise-up`), counts pop
(`animate-pop`), scrims fade. `prefers-reduced-motion` turns it all off.

## The shell (`components/shell/app-frame.tsx`)

- Desk: a 240px sidebar in `sidebar` tint, 28px rows, uppercase section captions, counts as
  accent pills; folds to a 56px rail. A 52px header with the breadcrumb, the feedback button and
  the bell. Content scrolls under it.
- Phone: no sidebar. A five-stop tab bar along the bottom (Today · Work · Inbox · Me · More) with
  a count on the shoulder of the stop that has something waiting; "More" slides the full menu in.
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
- Empty states are a row of the grid (`TableEmpty`, `ListEmpty`): one sentence, and when there is
  something to do about it, the add row under it.
- No hand-rolled `rounded-xl border` boxes, no `divide-y` lists, no raw `<table>`, no coloured
  left borders, no emoji, no second accent.

## Phone first

Write the phone layout, then widen: single column, `TileGrid` two across, tables that matter on
the go given a `List` alternative, actions stacked and full width, the hero action last and in
reach of the thumb. 44px targets. Nothing fixed to the top of the page but the shell's header.
Content gets `pb` for the tab bar from the shell; pages add none.
