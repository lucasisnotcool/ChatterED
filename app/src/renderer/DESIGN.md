# Tutorial workspace design

This file records the Studio typography, colours, and workspace presentation used by both the localhost prototype and the Electron renderer on `UX-Revamp`. The prototype still has scripted sample behaviour; the Electron app retains its own stores, IPC, and backend.

## Scope

The Studio theme from the installed Hallmark skill informs typography, type sizes, colours, and accents. The PDF viewer, working document, source controls, chat tabs, splitters, and navigation keep their existing behaviour. Electron maps the existing CSS role tokens in `styles/app.css` to this palette.

## Typography

- Display: Hedvig Letters Serif, weight 400, for the brand, page titles, panel headings, question headings, and source headings.
- Body and controls: Geist, with the system sans serif as fallback. Labels use sentence case and normal tracking.
- The standalone HTML prototype requests both faces from Google Fonts. Electron's local-only CSP uses the installed face when available and falls back to Georgia for display and the system sans serif for body text. The Electron build does not fetch remote fonts.
- The base size is 16px. Main page headings are 30px, the brand is 23px, panel headings are 18px, and question headings are 17px. Dense controls keep their existing compact sizes so the three-column workspace remains usable.
- Chat uses Geist at 14px for messages and the composer, 13px for tabs, and 12px for supporting text. Speaker names remain accessible but are visually replaced by circular avatars. Ellie uses a green tint, Max a warm orange tint, and the learner a light blue tint. The composer shows a generic prompt and a visible destination line.

## Colour roles

The prototype declares these roles in its `:root` block, using the Hallmark Studio palette:

| Token | Use |
|---|---|
| `--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-paper-hi` | Cool white backgrounds and surface steps |
| `--color-ink`, `--color-ink-2`, `--color-muted` | Primary, secondary, and supporting text |
| `--color-rule` | Panel and control borders |
| `--color-accent`, `--color-accent-soft`, `--color-focus` | Cadmium orange actions, selected states, and focus |
| `--color-danger`, `--color-danger-soft` | Source removal hover and error text |
| `--color-peer`, `--color-challenger` | Ellie and Max identity, kept distinct from the general action accent |

Uploaded PDF pages are rendered from their files and are never recoloured. The preloaded sample sheets are HTML mock pages, clearly marked “Interactive sample,” so the demo can be used before a file is uploaded.

The Tutorial and Summary notes tabs sit at the centre of the global header and appear only while a workspace is open. The workspace name sits beside the brand as an inline editable field with a quiet hover border. Home and Search keep the brand and navigation rail, without workspace-specific tabs or title.

The contextual toolbar groups Sources and the tutorial selector on the left. The two-option PDF + working / Combined sheet control and Chats sit on the right. There is no separate “Tutorial view” caption. The source sections use labelled + icon buttons; each file still has its own removal control.

PDF + working shows the unchanged original PDF beside one continuous working document. Combined sheet previews prompts and answer boxes on one sheet. The browser preview fills combined prompts from extracted PDF text and makes no AI call; Electron's existing combined sheet is AI generated. Both prototype modes share the same answer drafts.

At narrow widths, Sources and Chats start collapsed and open as side overlays. At desktop widths, they start open beside the PDF and working document. The sample actions show deterministic responses in Doc chat: Check, Hint and Show answer display Max; Refresher displays Ellie. Note actions display Ellie for Explain/Example and Max for Quiz me. Private tabs remain visible to model the live backend's privacy boundaries.

## Summary notes sample

The Summary notes mode now shows a notes toolbar, map, learning overview, editable sample sections, source page labels, hover/focus section actions, and an anchored Max question. Explain and Example display sample Ellie turns in Doc chat and add a sample inline edit with Remove/Keep. Quiz me opens a sample Max turn; Ask focuses the chat composer on the selected section. Freeze pauses further sample inline edits while allowing chat, following the visible distinction in Electron. Listen uses the browser's speech API where available; Insert and Add a question create visibly marked local sample blocks. Zoom changes the notes page scale. These sample note edits stay in the current browser tab and do not represent Electron persistence.

## Inline agent edits

The prototype follows the Electron edit lifecycle in both views. An agent's short addition stays beside its target, identifies Ellie or Max, and has Remove and Keep controls on that edit. Remove deletes only the agent addition. Keep removes the agent tint and controls, leaves the text in the document, and allows further typing. The edit rail is solid and thin, with compact controls; dashed or dotted edit outlines are not used. In tutorial working, Hint, Refresher, and Show answer add a sample short line under that question while the full sample response appears in Doc chat. Check stays in chat. Tutorial edit decisions and kept text are saved with that tutorial's working in browser local storage. The notes edit sample remains browser-session-only.

## Workspace names

Home lists the tutorial workspaces in this browser preview. A learner can create a named workspace and rename the open one inline in the top header. Names are trimmed, case-insensitively unique, and limited to 60 characters. Workspace names are saved in browser local storage. Each workspace keeps its own source lists, selected tutorial, working answers, and preview chats while the tab stays open. Uploaded `File` objects are browser-session data; after a reload, the named workspaces remain but their source files must be added again. The first workspace reloads with sample sources for testing.

## Prototype boundary

The localhost page does not call the Electron agent or notebook backend. Its sample replies are labelled as such and never grade a real answer. Home and Search show preview content; in the Electron app those buttons continue to use its existing notebooks and search flows. The separate `tutorial-workspace-parity.html` route mounts the real renderer with a development mock bridge for feature inventory; it is not the primary design prototype.

## Electron renderer boundary

The PDF + working view reads source bytes through the existing bridge. Existing generated parts and answer slots remain the only ones with Check, Hint, and Refresher actions. Numbered questions missing a backend part may have a clearly local draft section, without an agent action or grading claim. Combined sheet remains the original generated document. Agent inline edits retain Remove and Keep; real conversations stay in their existing Doc chat, Ellie, or Max channels. The chat panel can be closed visually while its component and unsent draft stay mounted.
