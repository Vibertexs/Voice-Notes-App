# Handoff: VoiceFlow mobile UI (Android)

## Overview
Full mobile UI for the VoiceFlow recording app: onboarding + mic permission, folders, recording with live transcript, finish/cancel, save outcomes, lock-screen notification, playback with synced transcript, in-transcript search, AI summary, global search, folder create/edit, move/share/delete, empty and error states.

Target: `mobile/` (Expo / React Native) in `Vibertexs/Voice-Notes-App`.

## About the design files
The `.dc.html` files here are **design references built in HTML**: they show the intended look and behavior. They are not production code. Rebuild them in `mobile/` with React Native components and the patterns already used there (navigation, audio, storage). Open any `.dc.html` in a browser to see it (keep `support.js` in the same folder).

- `VoiceFlow.dc.html`: clickable prototype. The left rail jumps to every screen.
- `VoiceFlow Screens.dc.html`: all screens side by side, including variants.
- `VoiceFlow Components.dc.html`: component sheet.
- `VF*.dc.html`: one file per component. Map each one to an RN component.

## Fidelity
**High fidelity.** Colors, type, radii, spacing and copy are final. Match them.

## Design tokens
**Colors**
- Background: `#0A0A0D` (app), `#060608` (deepest)
- Surfaces: `#141419` (list group), `#16161B` (row/card), `#17171C` (sheet), `#1A1A20` (search field), `#1C1C22` / `#1F1F26` (chips, inputs), `#26262E` (play circle, selected tab), `#2A2A32` (toast)
- Text: `#F4F4F6` primary, `#C9C9D1` secondary, `#8E8E98` muted, `#6A6A74` / `#55555E` faint
- Accent: `#FF2D55` primary red; `#FF5A78` red text on dark; `#9B5CFF` violet end
- Signature gradient (waveform, logo): `#FF2D55 → #9B5CFF`, interpolated per bar left→right
- Status: success `#2BD48F`, warning `#FFA62B`, info `#8E8EFF`
- Folder gradients (135°):
  - red `#FF2D55 → #E6286C → #C42A88`
  - blue `#2F86FF → #2A5CFF → #3D3AE0`
  - violet `#B04BFF → #8B3CF2 → #6A2BD8`
  - amber `#FF9A2E → #F2662C → #E0452E`
  - green `#22CC8E → #12A87C → #0C876C`
  - graphite `#34343D → #24242B`
- Hairlines: `rgba(255,255,255,.05–.06)`

**Type:** Figtree (Google Fonts, 300–700). Mono for timestamps: system monospace.
- Screen title 30/700, −0.8 letter-spacing
- Detail title 27/700, −0.7
- Sheet title 21/650, −0.4
- Row title 16/600, −0.2
- Body 15–16/400, line-height 1.5
- Meta 12.5–13.5/400 `#8E8E98`
- Section label 11.5/700, +1 letter-spacing, uppercase
- Live transcript: current line 30/650 (−0.6), previous lines 23/600 `#4A4A53`
- Recording timer 22/600 tabular; waveform-first variant 76/300 (−3)

**Radii:** pill buttons 999 · rows 20 · folder card 22 (tile 24) · sheet 32 (inset 8px from screen edges) · search field 24 · inputs 16 · toast 18 · icon tiles 12–14.

**Spacing:** screen padding 16 horizontal (24 on full-bleed flows) · list gaps 8–10 · minimum hit target 44.

**Shadows**
- Primary button: `0 8px 24px rgba(255,45,85,.32)`
- Record button: `0 0 0 6px rgba(255,45,85,.16), 0 12px 36px rgba(255,45,85,.5)`
- Sheet: `0 -20px 60px rgba(0,0,0,.5)`
- Toast: `0 14px 36px rgba(0,0,0,.5)`

## Components (see `VF*.dc.html` for props)
- **VFButton:** variants primary / secondary (`#22222A`) / ghost / danger (`rgba(255,45,85,.12)` bg, `#FF5A78` text). Sizes md 52h / sm 40h. Optional icon (plus, check, play). Disabled = 38% opacity. Press = scale .97.
- **VFFolderCard** (redesigned). Dark tinted surface, `#131318`. It has a corner glow `radial-gradient(120% 90% at 0% 0%, rgba(C,.20), transparent 62%)` and a 1px inner ring `rgba(C,.18)`, where C is the folder color (graphite uses .10 for both). Folder cards stay clean: no recording or waveform imagery. The icon is a solid-gradient rounded square with a white filled folder glyph. Four layouts:
  - `hero`: 140h, radius 28. A 48px icon top-left and a 44px ⋯ button top-right; name 22/700 and meta ("3 recordings · 49 min") bottom-left. Nothing else: no waveform, no play button, no recording preview.
  - `tile`: 140h, radius 26, for a 2-column grid. A 42px icon and ⋯ at the top; name 17/650 and meta at the bottom.
  - `row`: 68h, radius 20. 40px icon, name, meta, chevron.
  - `target`: 88h, radius 20. The drag-and-drop drop zone. Hovering scales it to 1.04 with a 2px color ring and glow, and the meta changes to "Drop to move". The source folder shows `disabled` (38% opacity, "Current").
  - Icon gradients (145°): red `#FF5A7A→#E0286C`, blue `#5B9BFF→#2A5CFF`, violet `#B983FF→#7B3CF2`, amber `#FFAE5C→#F2662C`, green `#4BDDA6→#0FA57A`, graphite `#4E4E5A→#32323B`.
- **VFRecordingRow:** `mode="drag"` swaps ⋯ for a 6-dot grip, makes the whole row draggable, and shows the source row at 35% opacity while it's being dragged. Default mode: 46px play circle (`#26262E`, or red while playing), title, "date · duration", optional 2-line snippet. While playing, a 3px red progress bar. A just-saved row gets a red ring `0 0 0 1.5px rgba(255,45,85,.7)` plus glow.
- **VFWaveform:** evenly spaced rounded bars (radius 3, gap 2–3). Colored bars are played/live; unplayed bars are `#34343D`; paused bars are `#3A3A44`. White playhead 2px wide with glow. Tap to seek.
- **VFRecordButton:** three states:
  - idle: 72px red circle with a 24px white dot
  - recording: 80px ring with a 3px red inset and two white pause bars
  - paused: 80px ring with a `#3A3A44` inset and a 30px red dot
- **VFSlideToCancel:** 56h track `#1F1F26` with a 48px red knob and chevron. Past 60% the label turns red ("Release to cancel"). Releasing past 85% cancels; otherwise the knob springs back over 350ms with `cubic-bezier(.2,.8,.2,1)`.
- **VFBottomSheet:** 60% black scrim, 36×4 grab handle, optional 60px status icon (check / warn / x), title, subtitle, then children. Slides in from the bottom over 400ms with the same easing.
- **VFSearchField:** 48h pill with a search icon and a clear button. On focus, ring `rgba(255,45,85,.55)`.
- **VFToast:** kinds success / error / info shown as a colored dot, message, optional action (Undo / View). Auto-hides after 3s. Sits 36px above the bottom edge.

## Screens
1. **Onboarding:** logo tile, "VoiceFlow" title, tagline, 3 feature rows, "Allow microphone" plus a ghost "Not now" button. Tapping Allow opens the Android system permission dialog.
2. **Mic denied:** crossed-out mic icon, explanation, the Settings path, then "Open Settings" and "Not now" buttons.
3. **Folders (home):**
   - Title plus two round buttons: Organize (move icon) and + (new folder). Then the search field (tapping it opens global search).
   - Bento layout: the first pinned folder is a full-width `hero` card, the other pinned folders are `tile` cards in 2 columns, then an "Other" section of `row` cards (8px gap).
   - Variant: every folder as a tile, plus a "Recent" list.
4. **Folder:**
   - The top of the screen has a radial glow in the folder color: `rgba(C,.26)` at 15% / −5%, 460×300.
   - Top bar: back, Organize (opens Organize filtered to this folder), ⋯ (edit folder).
   - Header: 60px icon tile, name 30/700, meta.
   - Below: recording rows.
   - Empty state: gray bars, "No recordings yet", "Tap record below — new recordings land here.", and a fading line pointing down to the record button.
   - There is no "New Recording" button. The persistent record button (see rule below) records into this folder.
5. **Recording:**
   - Top bar: × (opens the finish sheet), title plus folder name, lock icon.
   - Blinking red dot, timer, REC/PAUSED label.
   - Live transcript fades in from the top: the last 2 finished sentences in gray, the current line in white.
   - Live waveform 120h, then the record/pause button. A "Finish" chip appears to its right while paused.
   - Variant: waveform-first (large timer, 190h waveform, 2-line transcript strip).
6. **Finish sheet:** check icon, "Finish recording?", "Save this recording to {folder}?", "Finish Recording" button, slide-to-cancel.
7. **Storage almost full sheet:** warning icon, used-storage bar (VoiceFlow share in red), "Free up space" and "Keep recording" buttons.
8. **Saving:** spinner with a red→magenta arc, "Saving recording…". Stays for about 1.5s.
9. **Saved:** 88px red check circle, "Recording saved", "{title} has been saved to {folder}", "View Recording" and "Back to {folder}" buttons. Returning to the folder highlights the new row.
10. **Canceled:** × circle, "Recording canceled", "Record again" and "Back to Folders" buttons.
11. **Lock screen / ongoing notification:** app name plus Recording/Paused, title, folder, timer, mini waveform, Pause/Resume and Finish buttons. On Android, build this as a foreground-service media-style notification.
12. **Recording detail + playback:**
    - Top bar: back, search, share, ⋯. Then title and meta.
    - Segmented control: Transcript / Summary.
    - Transcript: timestamped segments. The active segment is highlighted and its timestamp turns red. Tapping a segment seeks to it.
    - Fixed bottom player: scrubbable waveform, position/duration, speed (1× → 1.5× → 2×), back 15s, 68px play/pause, forward 15s, search.
13. **AI summary:** card with a violet hairline. Contains "OVERVIEW", "Generated on device", the overview paragraph, "KEY POINTS" bullets, and "ACTION ITEMS" checkboxes (checking one fills it red and strikes the text through). Variant: a collapsible summary card above the transcript instead of tabs.
14. **Transcript search:** the top bar becomes a search field showing "N matches in {title}". Matches are highlighted `rgba(255,45,85,.38)`.
15. **Global search:** recent-search chips. Results are cards showing title, folder · date, a red timestamp, and the snippet with the match highlighted. Tapping a result opens the recording at that timestamp with transcript search pre-filled. Empty state: "No results".
16. **Recording actions sheet:** Share audio · Share transcript · Move to folder · Delete (red). Delete shows a toast with Undo.
17. **Move to folder sheet:** radio list with color swatches. The current folder is marked "Current" and can't be picked. The button reads "Move to {folder}" and is disabled until a folder is picked. Shows a toast with View.
18. **New/Edit folder sheet:** name input, 5 color swatches (selected = white ring), live folder-card preview, Create/Save button (disabled while the name is empty). Edit adds "Delete folder" (its recordings move to Inbox).

**RULE: persistent record button.** Home, Folder and Organize always show the 72px idle record button, centered, 40px above the bottom edge, over a 160px fade-to-background gradient. Screen content gets 170px of bottom padding so nothing hides behind it. Where it records: Home → Inbox; Folder → that folder; Organize → the selected source folder (Inbox when the filter is All). Toasts sit 128px from the bottom so they clear the button (250px on the playback screen). While a drag is in progress, the drop-out zone replaces the button.

19. **Organize (drag & drop):**
    - Opened from the home top bar (filter = All) or from a folder's top bar (filter = that folder).
    - Top bar: back, "Organize" plus "Drag a recording onto a folder", and a "Done" pill.
    - A 3-column grid of `target` folder cards (gap 8), then horizontal filter chips (All plus each folder, with a colored dot and count; the selected chip is `#F4F4F6` with dark text), then the recording rows in `drag` mode.
    - **Dragging:** press on a row to pick it up. A ghost card (300w, rotated −2°, scale 1.03, `#24242C`, red 1.5px ring, big shadow) follows the finger. Its second line reads "Drop on a folder", then "Move to {folder}" or "Remove from {folder}" depending on what's under it.
    - Folder targets under the finger light up. The source folder is disabled.
    - **Drag out:** while dragging, the bottom record button is replaced by a dashed 84h drop zone, "Drop to remove from folder", which moves the recording to Inbox. It turns red when hovered. It isn't shown if the recording is already in Inbox.
    - **Drop:** the recording moves and a success toast appears with Undo. Dropping anywhere else cancels and the row springs back.
    - In React Native use `react-native-gesture-handler` + `react-native-reanimated`: long-press (≈250ms) to pick up, with a haptic tick on pickup and when entering a target. Hit-test targets with `measureInWindow`.

## Copy tone
Two tones are defined in `COPY` inside `VoiceFlow.dc.html`: `plain` (default) and `warm`. Pick one. All strings live there.

## State (reference: logic class in `VoiceFlow.dc.html`)
- `folders[]`: `{id, name, color, pinned}` — color ∈ red · blue · violet · amber · green · graphite
- Organize: `sourceFilter ('all' | folderId), drag {recordingId, x, y, overTargetId | '__out'} | null`
- `recordings[]`: `{id, folderId, title, date, durationSec, segments:[{t, text}], summary:{overview, points[], actions[]}}`
- Recording session: `folderId, title, elapsedSec, paused, levels[]` (the last ~64 amplitude samples, 0–1)
- Playback: `position, playing, speed`
- Plus: search query, active sheet, toast
- Default titles: "Lecture N" in University, otherwise "Recording N" / "Voice memo N".

Wire these to the existing backend (`backend/routers`, `transcription.py`) for transcripts and summaries.

## Assets
No bitmap assets. All icons are simple line icons (2–2.4 stroke, round caps). Swap in the icon set `mobile/` already uses, or `lucide-react-native`: mic, folder, search, lock, share, trash, check, x, chevron, play/pause, rotate-ccw/cw (±15s).
