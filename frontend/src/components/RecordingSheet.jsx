import { useState } from 'react';
import ActionSheet from './ActionSheet';
import { libraryApi } from '../lib/api';

/**
 * Everything you can do to a recording, in one place.
 *
 * The same sheet opens from a row in a folder and from the recording's own
 * screen. The screen passes `extras` - the entries that only make sense with a
 * player behind them, like the transcript - and they slot in above Delete. The
 * order, the icons and the wording never change between the two, because it is
 * the same sheet.
 */
export default function RecordingSheet({
  workspace, folders = [], subtitle, audioUrl, extras = [],
  onClose, onChanged, onDeleted, onToggleFavourite, notify,
}) {
  const [view, setView] = useState('menu'); // menu | rename | move
  const [renameTo, setRenameTo] = useState(workspace.title);

  async function rename() {
    const title = renameTo.trim();
    if (!title || title === workspace.title) { onClose(); return; }
    try { await libraryApi.updateWorkspace(workspace.id, { title }); notify('Renamed.'); onChanged(); }
    catch (caught) { notify(caught.message, 'error'); }
    onClose();
  }

  async function move(folderId) {
    try {
      await libraryApi.updateWorkspace(workspace.id, { folder_id: folderId });
      notify(folderId ? 'Moved.' : 'Moved out of its folder.');
      onChanged();
    } catch (caught) { notify(caught.message, 'error'); }
    onClose();
  }

  async function share() {
    const text = `${workspace.title}${subtitle ? ` — ${subtitle}` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: workspace.title, text });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(text); notify('Copied to the clipboard.'); }
      else notify('Sharing is not available here.', 'error');
    } catch { /* the share sheet was dismissed */ }
  }

  function exportAudio() {
    if (!audioUrl) { notify('That audio is not on this device.', 'error'); return; }
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `${workspace.title}.wav`;
    link.click();
  }

  async function remove() {
    if (!window.confirm(`Delete “${workspace.title}” and every recording in it? This cannot be undone.`)) return;
    try { await libraryApi.deleteWorkspace(workspace.id); notify('Recording deleted.'); onDeleted(); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  if (view === 'rename') {
    return (
      <ActionSheet title="Rename" onClose={onClose}>
        <input
          className="field"
          autoFocus
          value={renameTo}
          maxLength="180"
          placeholder="Recording name"
          aria-label="Recording name"
          onChange={(event) => setRenameTo(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && rename()}
        />
        <div className="modal-actions">
          <button className="btn quiet" onClick={onClose}>Cancel</button>
          <button className="btn primary quiet" onClick={rename} disabled={!renameTo.trim()}>Save</button>
        </div>
      </ActionSheet>
    );
  }

  if (view === 'move') {
    return (
      <ActionSheet
        title="Move to Folder"
        subtitle={workspace.title}
        onClose={onClose}
        items={[
          ...folders.filter((folder) => !folder.archived).map((folder) => ({
            label: folder.name,
            icon: folder.icon || 'folder',
            on: folder.id === workspace.folder_id,
            onSelect: () => move(folder.id),
          })),
          { label: 'No folder', icon: 'archive', onSelect: () => move(null) },
        ]}
      />
    );
  }

  return (
    <ActionSheet
      title={workspace.title}
      subtitle={subtitle}
      onClose={onClose}
      items={[
        { label: 'Rename', icon: 'pencil', keepOpen: true, onSelect: () => setView('rename') },
        { label: 'Move to Folder', icon: 'folder', chevron: true, keepOpen: true, onSelect: () => setView('move') },
        {
          label: workspace.favorite ? 'Remove from Favourites' : 'Add to Favourites',
          icon: workspace.favorite ? 'heartOn' : 'heart',
          on: Boolean(workspace.favorite),
          onSelect: () => onToggleFavourite(workspace),
        },
        { label: 'Share', icon: 'share', onSelect: share },
        { label: 'Export Audio', icon: 'download', onSelect: exportAudio },
        ...extras,
        { label: 'Delete', icon: 'trash', danger: true, onSelect: remove },
      ]}
    />
  );
}
