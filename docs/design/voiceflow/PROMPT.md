Paste this into Claude Code from the repo root:

---

Implement the VoiceFlow mobile redesign in `mobile/` (Expo / React Native).

Spec: `docs/design/voiceflow/README.md`. Follow it exactly: colors, sizes, radii, copy, and behavior.
Visual reference: the `.dc.html` files in the same folder. Open `VoiceFlow.dc.html` in a browser to click through every screen; the left rail jumps to each one. They are HTML references, NOT code to copy. Rebuild them in React Native.

Work in this order and stop after each step so I can check it:
1. Theme: create `mobile/src/theme.js` with the Design Tokens from the README. Load the Figtree font with expo-font.
2. Components: build one RN component per `VF*.dc.html` file in `mobile/src/components/`, with the same props: VFButton, VFFolderCard (hero/tile/row/target), VFRecordingRow (default/drag), VFWaveform, VFRecordButton, VFSlideToCancel, VFBottomSheet, VFSearchField, VFToast. Add a temporary screen that shows all of them, like `VoiceFlow Components.dc.html`.
3. Screens: build screens 1–19 from the README using the existing navigation. Follow the persistent record button rule.
4. Wire up: recording, playback and transcripts go through the existing audio/transcription code and the `backend/` API. Mock only what doesn't exist yet, and tell me what you mocked.

Use react-native-reanimated and react-native-gesture-handler for the sheets, slide-to-cancel and drag & drop. Use lucide-react-native for icons unless mobile/ already has an icon set. Don't change backend code without asking.
