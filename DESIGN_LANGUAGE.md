# Design language

This document describes the visual and interaction language used in Reklama, written so the same style can be rebuilt in any other product, on any platform. Every value below is taken from the working product. The reference implementation is listed at the end.

The style in one sentence: **near-black ink on white, separated by hairlines, with one clear action per screen and red reserved for problems.**

---

## 1. Principles

1. **Ink is the brand.** There is one colour: near-black ink on white. Hierarchy comes from size, weight, grey value and space, never from hue.
2. **Red means something is wrong.** Red is the only other colour. It marks overdue money, errors and destructive actions. It is never decoration and never a way to say "important".
3. **Hairlines, not shadows.** Surfaces are separated by 1px lines and a slight difference between page and panel. Shadows appear only on things that float above the page.
4. **One clear next step.** A screen has at most one filled (primary) button. Everything else is quieter.
5. **Quiet by default, detail on demand.** Show what is needed to decide or act. Put the rest behind "More details", a tab or the next page.
6. **Words do the work.** Sentence case, plain verbs, exact numbers. No emojis, no exclamation marks.

---

## 2. Colour

### Tokens

All greys are pure neutral (zero chroma). Do not substitute warm or cool greys.

| Token | Hex | Used for |
|---|---|---|
| `ink` | `#171717` | Headings, primary text, primary buttons, active states, filled status, chart bars, focus ring, text selection |
| `ink-hover` | `#404040` | Hover on ink fills; field labels; notice text |
| `text-secondary` | `#525252` | Supporting copy in lists, inactive navigation, avatar initials |
| `text-muted` | `#737373` | Subtitles, labels, metadata, table headers. The lightest grey allowed for text people must read |
| `text-faint` | `#a1a1a1` | Placeholders, counts, timestamps, inactive icons, navigation group labels. Supplementary text only |
| `decor` | `#d4d4d4` | Empty-state icons, row chevrons, the dash for an empty value, hovered control borders |
| `control` | `#e5e5e5` | Input borders, secondary-button ring, unfilled progress segments, timeline connector |
| `line` | `#ebebeb` | Card edges, page and section dividers, table header rule |
| `soft` | `#f5f5f5` | Row dividers inside cards, selected navigation item, chip and segmented tracks, avatars, notices, board columns |
| `canvas` | `#fafafa` | Page background, hover on white rows |
| `surface` | `#ffffff` | Cards, dialogs, inputs, sidebar |
| `danger` | `#e7000b` | Error text, overdue values, destructive button text, error toast |
| `danger-mark` | `#fb2c36` | Problem dots, failed progress segments |
| `danger-strong` | `#c10007` | Text inside red message boxes |
| `danger-soft` | `#fef2f2` | Background of error messages and problem notices, destructive-button hover |
| `danger-line` | `#ffc9c9` | Ring on red badges and on hovered destructive buttons |

### Rules

- **No second accent.** Success is ink, not green. Information is grey, not blue. Attention is an ink outline, not amber.
- **Status is carried by shape and words, not colour.** Filled, outlined, hatched and grey are distinct in greyscale and for colour-blind users. Always pair the mark with a word.
- **Red always comes with words**, for example "₹8.2 L overdue", never a red dot alone with no explanation nearby.
- **Imagery:** placeholders are greyscale. Real photos are shown as they are, inside a hairline frame, and never tinted.

### Contrast, measured

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on white | 17.9 : 1 | Any text |
| `text-secondary` on white | 7.8 : 1 | Any text |
| `text-muted` on white | 4.7 : 1 | Body text (passes WCAG AA) |
| `text-muted` on `canvas` | 4.5 : 1 | Body text, just passes |
| `text-faint` on white | 2.6 : 1 | Never for text people need; only counts, placeholders, timestamps next to a label |
| `danger` on white | 4.8 : 1 | Text |
| `danger-strong` on `danger-soft` | 5.9 : 1 | Text |
| `ink-hover` on `soft` | 9.5 : 1 | Text |

---

## 3. Typography

- **Typeface:** [Geist](https://vercel.com/font), free under the SIL Open Font License and available on Google Fonts. Fallback is the system UI font: SF Pro on Apple, Segoe UI on Windows, Roboto on Android.
- **Features:** `font-feature-settings: "ss01", "cv11"` everywhere. Base letter-spacing is `-0.005em`, and larger sizes are tightened further (see the scale).
- **Weights:** 400 regular, 500 medium, 600 semibold. Nothing heavier. Emphasis inside a sentence is weight 500 in ink, never bold, italic or underline.
- **Numbers:** use tabular figures (`font-variant-numeric: tabular-nums`) for every amount, count and date that sits in a column or changes. Right-align amounts.
- **Casing:** sentence case for everything, including titles, buttons, tabs, labels, menu items and table headers. No ALL CAPS, no Title Case, no small-caps eyebrow labels.

### Scale

| Role | Size | Weight | Tracking | Colour |
|---|---|---|---|---|
| Display (home greeting) | 32px | 600 | -0.025em | ink |
| Page title | 28px | 600 | -0.02em | ink |
| Headline figure | 26px | 600 | -0.02em | ink, or `danger` for a problem |
| Dialog title | 17px | 600 | -0.01em | ink |
| Card or section title | 15px | 600 | default | ink |
| Lead text (page subtitle) | 15px | 400 | default | muted |
| Body | 14px | 400 | default | ink or secondary |
| Small (labels, metadata, descriptions, table headers) | 13px | 400, or 500 for field labels | default | muted, labels `#404040` |
| Caption (badges, hints, legends, stage labels, group labels) | 12px | 400 or 500 | default | muted or faint |
| Micro (keyboard hints, avatar initials, count badges, calendar months) | 11px | 400 or 500 | default | varies |
| Data labels (calendar day numbers) | 9–10px | 400 | default | faint; inside data graphics only |

Titles and figures use a line height of about 1.25; body text uses about 1.5. Keep subtitles under about 670px wide and empty-state text under about 380px.

---

## 4. Space and layout

- **Base unit: 4px.** The steps in use are 4, 6, 8, 12, 16, 20, 24, 32, 40 and 48.
- **App frame:**
  - fixed sidebar 240px wide on screens 1024px and wider;
  - content column up to 1180px, centred;
  - side padding 20px on phones, 32px from 640px, 48px from 1024px;
  - top padding 32px, or 48px on desktop.
- **Rhythm:**
  - 32px from the page header to the content;
  - 24–40px between major blocks;
  - 24px gutter between cards;
  - 16px between form fields.
- **Grids:**
  - detail pages have a main column and a side column, roughly 3 : 2 or 2 : 1;
  - figure rows are 4 across on desktop and 2 across on phones.
- **Breakpoints:** 640px and 1024px. Below 1024px the sidebar becomes a drawer and a top bar appears (see Phones).
- **Density:**
  - text controls 40px tall;
  - list rows about 48px;
  - navigation rows 36px.
  - Prefer fewer, roomier rows to dense grids.

---

## 5. Shape

| Radius | Used on |
|---|---|
| 3px | Data cells (availability calendar) |
| 4–6px | Legend swatches, keyboard hints |
| 8px | Navigation items, icon buttons, brand mark |
| 12px | Inputs, selects, the search field, hoverable list rows, board cards, command-menu rows, inline error boxes |
| 16px | Cards, panels, notices, board columns, the command menu, screenshots |
| 24px | Dialogs |
| Full (pill) | Buttons, badges, chips, segmented controls, toasts, avatars, status dots, progress segments, count badges |

Larger surfaces get larger radii. Anything you press that carries text is a pill.

---

## 6. Depth and surfaces

There are three levels:
- **page:** `canvas`;
- **resting surface:** white with a 1px `line` edge;
- **floating surface:** white with a shadow.

| Element | Treatment |
|---|---|
| Cards and panels | 1px `line`, no shadow, ever |
| Dialogs | Shadow `0 25px 50px -12px rgb(0 0 0 / 0.10)`; scrim `rgb(0 0 0 / 0.32)` |
| Command menu | Shadow `0 25px 50px -12px rgb(0 0 0 / 0.25)` plus a 1px ring at 5% black; scrim 25% black |
| Toasts | Shadow `0 10px 15px -3px rgb(0 0 0 / 0.10)` |
| Mobile drawer | Large shadow; scrim 30% black |
| Draggable cards | 1px ring at 4% black; on hover `0 2px 12px rgb(0 0 0 / 0.06)` |
| Sticky top bar | White at 85% opacity with a 24px background blur, hairline underneath |

Never give a resting surface both a border and a shadow.

---

## 7. Icons

- **Set:** an outline icon set on a 24px grid with round caps and joins. The product uses [Lucide](https://lucide.dev).
- **Stroke:** 1.75 at every size, or 1.5 for large empty-state icons.
- **Sizes:**
  - 16px in buttons and inline;
  - 18px in navigation;
  - 15px in timeline markers;
  - 20px in the mobile top bar;
  - 28px in empty states.
- **Colour:** icons take the colour of their text. Inactive navigation icons are `text-faint`, and active ones are ink. Icons are never coloured and never sit on coloured tiles.
- **Icon-only buttons** are reserved for universally known actions: close, menu, search, sign out. Each one has an accessible name and a tooltip.
- **Arrows:**
  - a chevron at the end of a row means the row opens something;
  - a trailing arrow appears only on a button that moves a workflow to its next step;
  - never add arrows to text links.

---

## 8. Motion

- **Hover and state changes:** 150ms colour transitions, easing `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Dialog entrance:**
  - 180ms, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`;
  - from opacity 0, 8px lower, at 98.5% scale.
- **Toasts:** appear immediately and leave after 3.5 seconds.
- **Loading:** a small spinner inside the button that was pressed, and the button is disabled. No skeleton shimmer and no full-page spinners for actions.
- **Avoid:** bounce, parallax, looping animation and anything decorative.
- **Reduced motion (recommended):** when the user has asked for less motion, drop the dialog rise and keep only the fade.

---

## 9. Components

### Buttons

| Variant | Resting | Hover | Use |
|---|---|---|---|
| Primary | Ink fill, white text | `#404040` fill | The one main action on a screen or in a dialog |
| Secondary | White, ink text, 1px inset `control` ring | `canvas` fill, `decor` ring | Other actions |
| Ghost | No fill, `text-secondary` text | `soft` fill, ink text | Cancel, tertiary and toolbar actions |
| Destructive | White, `danger` text, 1px inset `control` ring | `danger-soft` fill, `danger-line` ring | Delete, cancel a booking, mark as lost |

| Size | Height | Side padding | Text |
|---|---|---|---|
| Small | 32px | 12px | 13px |
| Medium (default) | 36px | 16px | 14px |
| Large | 44px | 20px | 15px |

**Common to all sizes:**
- pill shape and weight 500;
- a 16px icon at stroke 1.75, with a 6–8px gap;
- the label never wraps;
- 40% opacity when disabled.

**Rules:**
- **At most one primary button per screen.** A dialog counts as its own screen.
- **Labels are a verb plus its object:** "Send quote", "Record payment", "Add screen".
- **Dialog footers** are right-aligned, with Cancel as a ghost button before the primary button.

### Text fields and selects

- **Box:**
  - 40px tall, 12px radius, white;
  - 1px `control` border, 12px side padding;
  - 14px ink text, `text-faint` placeholder.
- **Focus:** the border turns ink, with a 4px ring of ink at 5% opacity.
- **Disabled:** `canvas` fill and muted text.
- **Labels and hints:**
  - the label sits above the field, 13px weight 500 in `#404040`, with a 6px gap;
  - a required field gets a grey asterisk after its label;
  - a hint goes below the field, 12px muted.
- **Errors** appear in one block under the fields:
  - `danger-soft` fill, 12px radius, 13px `danger-strong` text;
  - the message says what to change.
- **Offer choices instead of typing:**
  - chips for common answers above a free-text box;
  - a segmented control for 2–4 exclusive options;
  - presets next to date fields.
- **Keep optional fields folded away** under "More details".

### Chips

- **Resting:**
  - pill shape, 1px `control` border, white;
  - 12px weight 500 text in `#404040`;
  - 4px × 12px padding.
- **Hover:** the border turns `text-faint`.
- **Selected:** ink fill, ink border and white text.

### Segmented control

- **Track:** a `soft` pill with 4px padding.
- **Options:** pills of 13px weight 500 text, with 6px × 14px padding.
- **Selected option:** white with a small shadow and ink text. Unselected options use `text-secondary`.

### Cards

- **Card:** white, with a 1px `line` edge and a 16px radius.
- **Header:**
  - padding of 24px at the sides, 20px on top and 12px below;
  - title 15px weight 600;
  - optional description 13px muted;
  - small action buttons aligned right.
- **Rows inside a card** are inset 12px and have a 12px radius, with a `canvas` fill on hover.

### Figure row

- **One card split into equal cells by hairlines:** 4 across on desktop, 2 on phones.
- **Each cell:**
  - 24px × 20px padding;
  - label 13px muted, then value 26px weight 600, then hint 13px muted.
- **A cell can be a link**, filled with `canvas` on hover.
- **The value turns `danger` only for a problem**, such as money overdue.

### Tables

- **Header:**
  - 13px weight 400, muted, sentence case;
  - 12px vertical padding;
  - a `line` rule underneath and no fill.
- **Rows:**
  - 14px text with 14px vertical padding;
  - `soft` dividers, with no divider after the last row;
  - `canvas` fill on hover.
- **Alignment:**
  - the first and last cells have 24px outer padding, so they line up with the card header;
  - amounts are right-aligned with tabular figures.
- **Two-line cells:** the main value is ink weight 500, with a muted 12–13px line underneath (a code or a place).
- **On small screens** the table scrolls sideways rather than wrapping cells.

### Key–value list

- **Label and value:** the label sits left in 13px muted, and the value sits right in 13px ink.
- **Rows:** 12px vertical padding with `soft` dividers.
- **Empty values** show a `decor` dash.

### Status

| Meaning | Badge | Dot (8px) |
|---|---|---|
| Done, active or confirmed | Ink fill, white text | Filled ink |
| Needs action from us | White, ink text, 1px ink ring | 1.5px ink ring |
| In progress or waiting on someone else | White, `#404040` text, 1px `decor` ring | 1.5px ink ring |
| Neutral, draft or closed | `soft` fill, `text-secondary` text | `decor` fill |
| Problem | White, `danger` text, `danger-line` ring | `danger-mark` fill |

- **Badge:** pill shape, 12px weight 500, 2px × 8px padding, with an optional 6px dot.
- **Where each form goes:**
  - in lists and tables, use the quiet form: an 8px dot and a 13px label;
  - keep badges for the single status beside a page title.

### Progress track (stages)

- **Segments:** a row of equal segments, 4px tall with pill ends and 6px gaps.
  - Reached: ink.
  - Not reached: `control`.
  - Failed: `danger-mark`.
- **Labels:** 12px, under each segment.
  - Current: ink, weight 500.
  - Done: `text-secondary`.
  - Upcoming: `text-faint`.
  - Failed: `danger`, weight 500.
- **Summary line:** a 13px muted line sits above the track, such as "Stage **Negotiation**".
- **Moving stages:** when the user may change the stage, each segment is a button, and hovering an upcoming segment darkens it to `text-faint`.

### Tabs

- **Layout:** a row sitting on a `line` rule, with items of 14px text, 12px vertical padding and 24px gaps.
- **States:**
  - active: ink, weight 500, with a 2px ink underline that covers the rule;
  - inactive: muted, turning ink on hover.
- **Counts** follow the label in `text-faint`.

### Sidebar navigation

- **Frame:** white, 240px wide, with a hairline on the right.
- **Top:**
  - the brand mark and name, with 20px padding;
  - below them a search button: 36px tall, `soft` fill, 12px radius, reading "Search", with a keyboard hint on the right.
- **Groups:**
  - 24px apart;
  - each has a 12px `text-faint` label in sentence case ("Sales", "Operations", "Money", "Admin").
- **Items:**
  - 36px tall, 8px radius, 12px padding;
  - an 18px icon, a 12px gap, then a 14px label.
- **Item states:**
  - active: `soft` fill, ink text, weight 500 and an ink icon;
  - inactive: `text-secondary` text, a `text-faint` icon and a `canvas` fill on hover.
- **Counts:** an ink pill at least 20px wide, with white 11px weight 500 tabular figures.
- **Footer:**
  - a hairline on top;
  - avatar, then name (13px weight 500) and role (12px muted);
  - a sign-out icon button.

### Command menu

- **Opening:**
  - Ctrl K, or ⌘K on a Mac, from anywhere;
  - also from the sidebar search button.
- **Panel:**
  - centred, 512px wide, 14% down the screen;
  - 16px radius, with the floating shadow and scrim.
- **Input:** 52px tall with 15px text and a `text-faint` search icon. It has no border, only a hairline underneath.
- **Results:**
  - rows with a 12px radius and 10px × 12px padding;
  - the highlighted row has a `soft` fill;
  - an optional hint ("Go to") sits on the right in 12px `text-faint`.
- **Order of results:**
  - actions first ("New quote");
  - then pages;
  - then "Search for …" once two characters are typed.
- **Keys:** arrow keys move through the results, Enter opens one and Esc closes the menu.

### Dialogs

- **Size:** centred, 448px wide, or 672px for complex forms. On phones the width is the screen width minus 32px.
- **Surface:** 24px radius, the floating shadow, the scrim and the entrance motion.
- **Header:**
  - 24px padding;
  - title 17px weight 600, with a 13px muted description;
  - a round ghost close button at the top right.
- **Body:** scrolls within 75% of the screen height.
- **Footer:** Cancel as a ghost button, then the primary button, aligned right.
- **Destructive confirmations** name the thing being removed.

### Toasts

- **Placement:** bottom centre, 24px from the edge. They sit above open dialogs.
- **Look:**
  - pill shape, ink fill;
  - white 13px weight 500 text, 10px × 16px padding;
  - the toast shadow.
- **Errors** use a `danger` fill.
- **Behaviour:** each toast leaves after 3.5 seconds, and screen readers announce it as a status.
- **Wording:** one short sentence in the past tense, such as "Quote sent" or "Payment recorded".

### Notices

- **Inline banner:**
  - 16px radius, `soft` fill;
  - 14px text in `#404040`, with 16px × 14px padding;
  - an optional 16px icon.
- **For problems:** a `danger-soft` fill with `danger-strong` text.

### Empty states

- **Layout:** centred with 56px vertical padding.
  - Icon: 28px, stroke 1.5, in `decor`.
  - Title: 15px weight 500, ink.
  - Text: one 13px muted line.
  - Action: one button.
- **What it says:** what will appear here, and how to add the first one.

### Avatars

- **Look:** initials on a `soft` circle, in `text-secondary` weight 500.
  - 32px circle with 11px initials.
  - 24px circle with 10px initials.
- **Never used:** photos, or a different colour for each person.

### Activity timeline

- **Markers:**
  - 32px circles with a `soft` fill, an ink 15px icon and a 4px white ring;
  - joined by a 1px `control` line;
  - system events use a white marker with a `control` ring and a `text-faint` icon.
- **Each entry:**
  - the person's name in ink weight 500, the verb in `text-secondary`, and the duration in `text-faint`;
  - the time right-aligned in 12px `text-faint` tabular figures;
  - any note below in 14px `text-secondary`.
- **Spacing:** entries are 24px apart.

### Board (drag and drop)

- **Columns:**
  - 272px wide, `soft` fill, 16px radius, 16px apart;
  - header: name in 14px weight 500, count in `text-faint`.
- **Cards:**
  - white, 12px radius, 14px padding;
  - a 4% black ring, with a soft shadow on hover.
- **While dragging:** the dragged card drops to 40% opacity, and the column under it darkens slightly.
- **Card content:**
  - name in 14px weight 500;
  - up to two lines of context in 13px muted;
  - a 12px muted footer with the next step (in `danger` if overdue) and the deal value in ink weight 500.

### Tasks and steps

- **Task checkboxes:** 20px circles. A done task is an ink fill with a white 12px tick.
- **Guided multi-step forms:**
  - number each step with a 24px ink circle holding a white 12px number;
  - keep a live summary panel on the right that stays in view while scrolling;
  - show the total in that panel at 26px weight 600.

### Brand mark and keyboard hints

- **Brand mark:**
  - a 28px ink square with an 8px radius and a white 13px weight 600 initial;
  - the name next to it, 15px weight 600, -0.01em, 10px away.
- **Keyboard hint:**
  - white, 1px `control` ring, 6px radius;
  - 11px muted text, 2px × 6px padding;
  - written "Ctrl K" (⌘K on a Mac).

---

## 10. Charts and data

- **One hue.** Ink on `soft` tracks. There are no categorical rainbows. If a second series cannot be avoided, use `text-faint` and `decor` and label the series directly.
- **Bar lists:**
  - label on the left, up to 144px wide and truncated;
  - bar 12px tall in ink, with a 4px rounded end;
  - value at the tip of the bar in 12px weight 500 tabular figures;
  - the longest bar reaches 85% of the width, so the value always fits.
- **Meters:** an 8px pill with a `soft` track and an ink fill.
- **Negative values** (such as a loss) are the one place red appears in a report.
- **Availability grid:** day cells 14px × 28px, 2px apart, 3px radius.

  | State | Cell |
  |---|---|
  | Free | `soft` |
  | Partly sold | `decor` up to a third, `text-faint` up to two thirds, `text-muted` above that |
  | Fully booked | ink |
  | On hold | White with an ink diagonal hatch (1px lines every 5px at 135°) and a `decor` ring |
  | Maintenance | `control` with a white diagonal hatch at 45° |

  Always show a legend. Every cell also has a plain-text tooltip, such as "12 Oct: 4 of 10 slots sold, 2 on hold".

---

## 11. Page patterns

### Anatomy of a page

1. **Back link** on detail pages: 13px muted with a left chevron, naming the parent ("Quotes").
2. **Title** at 28px weight 600, with at most one status badge beside it.
3. **Subtitle:** one 15px muted line of context, such as "For Kaveri Silks, prepared by Arjun Rao. Valid until 8 Oct 2026."
4. **Actions** on the same row, aligned right. Secondary actions come first and the one primary action sits at the far right.
5. **Content** starts 32px below.

### Home

- **Header:** a 13px muted date line, then the greeting at 32px.
- **Needs attention:** a single card with one sentence per item.
  - Each item starts with a status dot, red for problems.
  - The key noun is in ink weight 500.
  - Each row ends with a chevron.
- **Below that:** a row of the four figures that matter for this person, then today's tasks and this week's events.

### Record pages (a client, quote, booking or invoice)

- **Top card:**
  - the progress track;
  - one sentence on where things stand ("Waiting for the client's decision");
  - the single suggested next step as the primary button.
- **Main column:** the substance, such as line items, the timeline or the tax invoice.
- **Side column:** summary, versions and details, as key–value lists.

### Lists

- **Above the table:** search on the left, then filters as selects or chips.
- **Counts** appear in the tab labels.
- **When the list is empty,** the empty state sits inside the card.

### Forms

- **One column, 16px between fields.** Put two fields side by side only when both are short, such as dates or amounts.
- **Optional fields** go under "More details".

### Sign-in

- **Column:** centred, 380px wide.
- **Contents:**
  - brand mark;
  - title and subtitle;
  - the form;
  - where relevant, a card listing accounts as rows.

### Phones

- **Navigation:** it moves into a 288px drawer behind a 30% scrim.
- **Top bar:** a 56px sticky, translucent bar holding menu, brand and search.
- **Layout changes:**
  - figure rows go 2 across;
  - tables scroll sideways;
  - two-column pages stack with the main column first.
- **Touch targets:** at least 40px, and 44px where space allows.

### Printed documents (quotes, invoices, receipts, PDFs)

- **Look:**
  - same typeface and hairline tables, on white, sized for A4;
  - ink only, with a letterhead carrying the brand mark.
- **Figures:** amounts right-aligned in tabular figures, with totals at weight 600.
- **Letterhead contact lines** may use middle dots as separators. This is the only place they are allowed.

---

## 12. Writing

- **Sentence case everywhere.**
- **Buttons** are a verb and its object: "Send quote", "Record payment". Never "Submit", "OK" or "Click here".
- **Say what will happen and when:** "Screens held until 26 Sept, 10:50 pm."
- **Numbers carry their units and use local formats:**
  - "₹4,67,280", "₹14.8 L";
  - "3 of 14", "21% occupied".
  - Dates read "26 Sept 2026", and times "10:50 pm".
- **Metadata** is written with commas, like "LED screen, MG Road". Do not use middle dots, pipes or slashes.
- **Links** say where they go ("All bookings"), with no trailing arrows and no "Learn more".
- **Errors** say what went wrong and what to do next. Success messages are short and in the past tense.
- **Empty states** explain what goes there and how to add the first one.
- **Avoid:** emojis, exclamation marks, "Oops", and jargon when a plain word exists.

---

## 13. Accessibility

- **Focus:**
  - every interactive element shows a 2px ink outline, 2px offset, when focused from the keyboard;
  - text inputs show the ink border and soft ring instead.
- **Text selection:** ink background with white text.
- **Contrast:** text people must read is `text-muted` or darker. See the contrast table in section 2.
- **Status** is never shown by colour alone. It always has a shape and a word.
- **Every input has a visible label.** Placeholders are examples, not labels.
- **Dialogs:**
  - use the platform's modal dialog, so focus stays inside and Esc closes it;
  - the command menu works entirely from the keyboard.
- **Icon-only buttons** have accessible names.
- **Toasts** are announced to screen readers as status messages.

---

## 14. What to avoid

Each of these makes an interface look generated or cluttered:

- Gradients, glows or glass effects on resting surfaces.
- Coloured icon tiles, or a different colour for each section or category.
- Shadows on cards.
- More than one filled button on a screen.
- Green for success, blue for information or amber for warnings.
- ALL CAPS eyebrow labels above headings.
- Emojis anywhere, including toasts and empty states.
- Middle-dot metadata strings in the interface ("LED · MG Road · 10 slots").
- Arrows appended to links ("View all →").
- Decorative illustrations.
- Dense toolbars.
- Forms that show every optional field up front.
- Centred body text.
- Pill badges on every row of a table.

---

## 15. Rebuilding it on another platform

### CSS custom properties (any web stack)

```css
:root {
  --ink: #171717;
  --ink-hover: #404040;
  --text-secondary: #525252;
  --text-muted: #737373;
  --text-faint: #a1a1a1;
  --decor: #d4d4d4;
  --control: #e5e5e5;
  --line: #ebebeb;
  --soft: #f5f5f5;
  --canvas: #fafafa;
  --surface: #ffffff;

  --danger: #e7000b;
  --danger-mark: #fb2c36;
  --danger-strong: #c10007;
  --danger-soft: #fef2f2;
  --danger-line: #ffc9c9;

  --radius-cell: 3px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-pill: 999px;

  --shadow-dialog: 0 25px 50px -12px rgb(0 0 0 / 0.1);
  --shadow-toast: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  --scrim: rgb(0 0 0 / 0.32);

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0.2, 0.8, 0.2, 1);

  --font-sans: "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sans);
  font-feature-settings: "ss01", "cv11";
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--ink); color: #fff; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```

### Tailwind CSS 4

The product uses Tailwind's built-in `neutral` and `red` scales. The tokens above correspond to:
- `neutral-900` (ink), `700`, `600`, `500`, `400`, `300`, `200`, `100` and `50`;
- `red-600`, `500`, `700`, `50` and `200`.

It adds two tokens of its own:

```css
@theme {
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --color-canvas: #fafafa;
  --color-line: #ebebeb;
}
```

Tailwind radius names map as follows:
- `rounded-lg` is 8px;
- `rounded-xl` is 12px;
- `rounded-2xl` is 16px;
- `rounded-3xl` is 24px.

### Native apps and design tools

- **iOS and Android:**
  - keep the same scale in points or dp;
  - Geist ships as OTF and TTF files; otherwise use SF Pro or Roboto at the same sizes;
  - hairlines stay one logical pixel;
  - use the platform's own sheets and dialogs, restyled with the radii and scrims above.
- **Figma or similar:**
  - create colour variables with the token names from section 2;
  - create one text style per row of the type scale;
  - build button, chip, badge and status-dot components with every variant and size listed here.

---

## 16. Review checklist for a new screen

- [ ] Only ink, greys and, for problems, red.
- [ ] One primary button at most.
- [ ] Cards separated by hairlines, with no shadows on resting surfaces.
- [ ] Sentence case throughout, with no capitals-only labels and no emojis.
- [ ] Every number formatted, with units, in tabular figures where it lines up.
- [ ] Every status readable without colour (shape plus word).
- [ ] All text people must read is `#737373` or darker.
- [ ] A visible focus state on every control.
- [ ] Empty, loading and error states designed, not left to chance.
- [ ] Works at 375px wide.
- [ ] Nothing on the screen can be removed without losing something the user needs to decide or act.

---

## Reference implementation

| File | What it holds |
|---|---|
| [src/app/globals.css](src/app/globals.css) | Colour tokens, base type settings, focus, selection, dialog motion |
| [src/app/layout.tsx](src/app/layout.tsx) | Geist font loading |
| [src/components/ui.tsx](src/components/ui.tsx) | Buttons, cards, badges, fields, page header, figure row, tabs, avatars, tables, notices, key–value lists, status dots |
| [src/components/shell.tsx](src/components/shell.tsx) | Sidebar, mobile top bar and drawer, brand mark, command menu |
| [src/components/forms.tsx](src/components/forms.tsx) | Dialogs, toasts, form error and pending states |
| [src/components/inputs.tsx](src/components/inputs.tsx) | Chips, segmented control, date presets |
| [src/components/progress.tsx](src/components/progress.tsx), [src/components/stage-stepper.tsx](src/components/stage-stepper.tsx) | Progress tracks |
| [src/components/charts.tsx](src/components/charts.tsx), [src/components/availability-strip.tsx](src/components/availability-strip.tsx) | Bar lists, meters, availability grid and legend |
| [src/components/activity.tsx](src/components/activity.tsx), [src/components/kanban.tsx](src/components/kanban.tsx) | Timeline and board |
