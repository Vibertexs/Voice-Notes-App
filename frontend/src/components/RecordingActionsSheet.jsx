import { useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { Icon } from './Icon';
import { libraryApi } from '../lib/api';
import { newestFirst, shareNative, transcriptText } from '../lib/share';

/**
 * Everything you can do to a recording, in one place.
 *
 * The same sheet opens from a row in a folder and from the recording's own
 * screen. The screen passes `extras` - the entries that only make sense with a
 * player behind them, like bookmarking the moment you are listening to - and
 * they slot in above Delete. The order, the icons and the wording never change
 * between the two, because it is the same sheet.
 *
 * No status icon, so it aligns left and reads as a list of choices rather than
 * an announcement. Delete does not confirm: the toast it raises carries Undo,
 * and a confirm plus an undo is one question too many.
 */
export default function RecordingActionsSheet({
  open, recording, subtitle, extras = [],
  onClose, onChanged, onDelete, notify,
}) {
  const [view, setView] = useState('menu');   // menu | rename
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    setView('menu');
    setTitle(recording?.title ?? '');
  }, [open, recording?.id, recording?.title]);

  async function rename() {
    const next = title.trim();
    onClose?.();
    if (!next || next === recording?.title) return;
    try {
      await libraryApi.updateWorkspace(recording.id, { title: next });
      notify?.('Renamed');
      onChanged?.();
    } catch (caught) { notify?.(caught.message, 'error'); }
  }

  async function favourite() {
    onClose?.();
    try {
      await libraryApi.updateWorkspace(recording.id, { favorite: !recording.favorite });
      notify?.(recording.favorite ? 'Removed from favourites' : 'Added to favourites');
      onChanged?.();
    } catch (caught) { notify?.(caught.message, 'error'); }
  }

  /**
   * Share the transcript or the audio through the phone's own share sheet.
   *
   * The row this opened from has only a title, so what is shared is read from the full
   * recording. Inside the app the shell opens the share sheet (lib/share.js); in a browser,
   * which has none, text falls back to the clipboard and audio to a download.
   */
  async function shareTranscript() {
    onClose?.();
    try {
      const text = transcriptText(await libraryApi.workspace(recording.id));
      if (!text) { notify?.('There is no transcript to share yet.', 'error'); return; }
      if (await shareNative({ kind: 'text', title: recording.title, text })) return;
      if (navigator.share) { await navigator.share({ title: recording.title, text }); return; }
      if (navigator.clipboard) { await navigator.clipboard.writeText(text); notify?.('Transcript copied'); return; }
      notify?.('Sharing is not available here.', 'error');
    } catch (caught) {
      // Dismissing the share sheet is not an error; anything with a message is worth showing.
      if (caught?.name !== 'AbortError') notify?.(caught?.message || 'Could not share the transcript.', 'error');
    }
  }

  async function shareAudio() {
    onClose?.();
    try {
      const session = newestFirst((await libraryApi.workspace(recording.id)).sessions).find((item) => item.audio_url);
      if (!session) { notify?.('That audio is not on this phone.', 'error'); return; }
      if (await shareNative({ kind: 'audio', title: recording.title, uri: session.audio_url })) return;
      const link = document.createElement('a');
      link.href = session.audio_url;
      link.download = `${recording.title}.wav`;
      link.click();
    } catch (caught) {
      if (caught?.name !== 'AbortError') notify?.(caught?.message || 'Could not share the audio.', 'error');
    }
  }

  if (view === 'rename') {
    return (
      <VFBottomSheet open={open} title="Rename" onClose={onClose}>
        <input
          className="sheet-input" autoFocus value={title} maxLength={180}
          placeholder="Recording name" aria-label="Recording name"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') rename(); }}
        />
        <VFButton label="Save" icon="check" disabled={!title.trim()} onPress={rename} />
      </VFBottomSheet>
    );
  }

  const items = [
    { icon: 'pencil', label: 'Rename', run: () => setView('rename'), keepOpen: true },
    {
      icon: recording?.favorite ? 'heartOn' : 'heart',
      label: recording?.favorite ? 'Remove from favourites' : 'Add to favourites',
      run: favourite,
    },
    ...extras,
    { icon: 'share', label: 'Share audio', run: shareAudio },
    { icon: 'text', label: 'Share transcript', run: shareTranscript },
    { icon: 'trash', label: 'Delete', run: () => { onClose?.(); onDelete?.(); }, danger: true },
  ];

  return (
    <VFBottomSheet open={open} title={recording?.title ?? 'Recording'} subtitle={subtitle} onClose={onClose}>
      <div className="sheet-list">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`sheet-item${item.danger ? ' is-danger' : ''}`}
            onClick={() => item.run?.()}
          >
            <Icon name={item.icon} strokeWidth={2} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </VFBottomSheet>
  );
}
