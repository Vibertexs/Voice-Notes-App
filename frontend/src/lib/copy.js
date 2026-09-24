/**
 * Every string the redesigned screens say.
 *
 * Taken verbatim from the `COPY` object in
 * docs/design/voiceflow/VoiceFlow.dc.html, `plain` tone. The handoff defines a
 * second `warm` tone and says to pick one; plain is the default and the one
 * these screens are written for. Keeping them here rather than inline is what
 * makes swapping tones a one-line change instead of a hunt.
 *
 * `fill` takes the {placeholders} the handoff writes into the strings.
 */
export const COPY = {
  tagline: 'Record. Learn. Revisit.',
  allow: 'Allow microphone',
  later: 'Not now',

  finishTitle: 'Finish recording?',
  finishSub: 'Save this recording to {folder}?',
  finishBtn: 'Finish Recording',
  slide: 'Slide to cancel',
  release: 'Release to cancel',

  savingTitle: 'Saving recording…',
  savingSub: 'Please wait a moment.',
  savedTitle: 'Recording saved',
  savedSub: '“{title}” has been saved to {folder}.',
  canceledTitle: 'Recording canceled',
  canceledSub: 'Your recording has been discarded.',

  emptyTitle: 'No recordings yet',
  emptySub: 'Tap record below — new recordings land here.',
  noResTitle: 'No results',
  noResSub: 'Nothing matches “{q}”. Try a different word.',

  micTitle: 'Microphone access is off',
  micSub: 'VoiceFlow needs the microphone to record and transcribe. Turn it on in Settings.',

  storageTitle: 'Storage almost full',
  // The handoff writes this with a literal 9. The sentence is kept exactly as
  // written and the number is filled in from what the device actually reports,
  // because a warning that states a figure it has not measured is worse than
  // no warning.
  storageSub: 'About {minutes} minutes of recording space left on this device.',

  searchHint: 'Search titles and everything that was said.',

  paused: 'PAUSED',
  live: 'REC',

  orgSub: 'Drag a recording onto a folder',
  orgEmpty: 'No recordings here.',
  dropOut: 'Drop to remove from folder',
};

export function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (
    values[key] === undefined || values[key] === null ? whole : String(values[key])
  ));
}

/** The five colours the folder editor offers. Graphite is reserved for Inbox. */
export const SWATCHES = ['red', 'blue', 'violet', 'amber', 'green'];
