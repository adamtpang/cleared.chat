# cleared.chat Design

The desktop app is plain HTML, CSS, and JavaScript in
`web/public/index.html`, served by `web/server.mjs` and wrapped in Electron.
The interface deliberately keeps its zero-build runtime. Adding React,
Tailwind, or another bundler would increase packaging cost without improving
the core inbox workflow.

## Reference

Built against shadcn `dashboard-01`: sidebar-inset hierarchy, compact bordered
surfaces, restrained badges, muted secondary text, and consistent focus rings.
That anatomy is adapted to a two-pane messenger with a collapsible chat list
and one active conversation.

## Direction

The selected palette is **Open Channel**. It is calm, technical, and direct.
The workspace is pale aqua in light mode and deep blue-black in dark mode.
White or lifted charcoal surfaces hold conversations. Teal is reserved for
selection, progress, and primary actions.

There are no decorative gradients. Status colors remain distinct from the
brand accent so urgency, success, and risk do not collapse into one hue.

## Semantic Tokens

Every brand hex was converted to OKLCH exactly. The stylesheet exposes the
standard shadcn semantic pairs, plus temporary legacy aliases used by the
existing plain HTML components.

| Semantic | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.9784 0.0053 197.07)` | `oklch(0.1967 0.0139 212.90)` |
| `--foreground` | `oklch(0.2379 0.0177 214.91)` | `oklch(0.9689 0.0107 204.12)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.2345 0.0166 216.41)` |
| `--primary` | `oklch(0.5382 0.0902 203.82)` | `oklch(0.7800 0.1076 200.49)` |
| `--primary-foreground` | `oklch(1 0 0)` | `oklch(0.2299 0.0310 206.04)` |
| `--secondary` | `oklch(0.9487 0.0097 204.91)` | `oklch(0.2866 0.0184 213.43)` |
| `--muted-foreground` | `oklch(0.5044 0.0270 209.87)` | `oklch(0.7636 0.0246 206.60)` |
| `--accent` | `oklch(0.9483 0.0232 200.08)` | `oklch(0.3245 0.0408 205.37)` |
| `--destructive` | `oklch(0.5327 0.1528 20.61)` | `oklch(0.7646 0.1405 17.67)` |
| `--border` | `oklch(0.8995 0.0151 202.04)` | `oklch(0.3286 0.0204 211.23)` |

Status colors:

| State | Light | Dark |
|---|---|---|
| Success | `#087A52` | `#55D49C` |
| Warning | `#9A5B00` | `#F0B457` |
| Danger | `#B43E45` | `#FF8B91` |

## Typography

Inter remains the product sans because it is already loaded by the app,
renders dense messaging data clearly, and avoids carrying forward Beeper's
Haskoy identity. System monospace is limited to compact labels, codes, and
technical metadata. Numerals use tabular spacing.

## Components

- One radius source: `--radius: 0.5rem`. Cards stop at 8px, controls at 6px,
  and compact indicators at 4px. Pills are reserved for tags and avatars.
- Primary buttons are 36px tall, teal, and use the paired foreground token in
  each theme.
- Cards use `--card`, a 1px `--border`, and only a small structural shadow.
- Inputs use a visible border and a three-pixel color-mixed focus ring.
- The sidebar track and conversation track use `minmax(0, 1fr)` so content
  cannot force page overflow.
- The mobile header keeps only navigation, settings, and voice. Desktop sizing
  controls are hidden below 820px.
- Incoming message content is shown exactly as received. Product-authored UI
  and drafts contain no emoji or em dash characters.

## Safety

The interface may read, prioritize, draft, revise, and copy. It never sends,
reacts, archives, or marks messages read. The final communication action stays
with the human in the original messaging client.

## Verification

Measured on the running app after loading real local data:

| Pair | Light | Dark |
|---|---:|---:|
| Body text | 15.50:1 | 16.67:1 |
| Primary button | 4.90:1 | 8.73:1 |
| Selected tab | 4.90:1 | 8.73:1 |
| Muted card copy | 5.82:1 | 7.92:1 |
| Incoming message bubble | 14.22:1 | 13.02:1 |

All measured pairs pass WCAG AA. The app has zero horizontal overflow at
1440x960 and 500x900 in both themes. Desktop and mobile screenshots were also
inspected for clipping, hierarchy, and control overlap. The public landing page
was inspected at the same desktop and mobile sizes after constraining its hero
grid and install command.
