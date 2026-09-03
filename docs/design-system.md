# Cleared interface system

## Direction

Cleared is a calm, high-agency messenger. It should feel familiar enough to
use without instruction and opinionated enough to move one open loop at a time.
The interface is neutral first. Green is reserved for progress, selection, and
confirmed actions. Amber means task-first work, blue means information, and red
means a connection or recovery problem.

The visual direction is called Clearspace. It borrows interaction principles,
not proprietary assets, from enduring messaging interfaces:

- WhatsApp: contact-first inbox rows, strong unread hierarchy, familiar bubbles.
- Telegram: an explicit Unread queue and a desktop sidebar for large chat sets.
- Apple split views: a hideable list beside focused detail, collapsing to one
  surface on narrow screens.
- Standard message composition: write and edit in context, then review in a
  separate confirmation layer.

References:

- https://shapeable.art/llms.txt
- https://telegram.org/blog/folders
- https://developer.apple.com/design/human-interface-guidelines/sidebars
- https://developer.apple.com/design/human-interface-guidelines/split-views
- https://www.nngroup.com/articles/progressive-disclosure/
- https://www.nngroup.com/articles/recognition-and-recall/
- https://www.nngroup.com/articles/aesthetic-minimalist-design/
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

## Daily hierarchy

1. Unread shows the source-of-truth queue.
2. Triage ranks open loops and prepares tasks and unsent drafts.
3. Focus shows one priority conversation at a time with visible progress.
4. Cleared removes only that private conversation version from the work queue.
5. Review reply shows the exact recipient and text before Adam can send.

No secondary control should compete with this sequence. Source management,
manual sync, appearance, density, and AI-provider controls belong in Settings.

## Tokens

Light surfaces use `#f8f8f6`, white, and graphite `#1f2825`. Dark surfaces use
`#111513`, `#181d1b`, and near-white `#eef2ef`. The primary green is `#0f7b63`
in light mode and `#70d1ae` in dark mode. Corners use a maximum 8px radius for
tools and sheets, with fully rounded treatments reserved for avatars, counts,
search, and message bubbles.

Typography uses the native system stack. This removes a render-blocking font
request and keeps the app aligned with its host operating system.

## Responsive rules

- Desktop uses a 64px Cleared rail, a 360px to 460px conversation list, and a
  flexible thread pane.
- At 820px and below, the list and conversation become mutually exclusive.
- Focus hides the list at every width and keeps one progress/navigation row.
- At 480px and below, Settings becomes an icon and the domain suffix is hidden.
- Composer controls never reduce the editable reply below the viewport width.

The thread uses an original low-contrast Clearspace pattern. Do not import or
trace WhatsApp's proprietary doodle artwork, logo, or other brand assets.

## Interaction rules

- Unread rows show only contact, preview, time, and unread count. Completion
  belongs in the open conversation, not in every row.
- Priority rows show only contact, next action, and rank. Scores, source labels,
  and classifications stay available to the ranking system without competing
  with the decision.
- Selected rows use a leading green rail and a subtle neutral-green surface.
- Focus begins at the next action, keeps one progress row, and uses one reply
  composer. Plan details remain behind a disclosure until Adam opens them.
- A successful triage does not add a persistent banner. Only stale results,
  failures, and reconnect states interrupt the daily flow.
- Reaction and forwarding controls stay quiet until message hover or keyboard
  focus on pointer devices, but remain discoverable on touch devices.
- Dialogs trap keyboard focus, close with Escape, and restore focus to their
  trigger.
- Reduced motion removes decorative transitions without changing state.
- Agents and background jobs never invoke send, reaction, or forwarding
  confirmation.

## Verification matrix

- 390 by 844, light and dark
- 1440 by 900, light and dark
- Unread, Focus, Settings, stale AI snapshot, and WhatsApp reconnect state
- Keyboard-only modal open, cycle, Escape, and focus restoration
- Reduced motion
- No horizontal overflow, duplicate IDs, nested interactive controls, or em
  dashes in rendered interface copy
