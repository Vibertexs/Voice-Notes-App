import FileList from './FileList';
import { Icon } from './Icon';
import RecordingRow from './RecordingRow';
import { EmptyState, IconButton } from './ui';
import { countLabel } from '../lib/format';

/**
 * What is inside a folder.
 *
 * The screen is the list. The folder's name and count are the title, and the
 * card is deliberately not repeated underneath it - saying "University, 5
 * recordings" twice, two lines apart, only costs the recordings their space.
 *
 * An empty folder is a different screen rather than the same one with a hole
 * in it: the name moves into the header, the card and the list go, and what is
 * left is the illustration and the one sentence that says what to do next.
 */
export default function FolderScreen({
  data, onBack, onOpenWorkspace, onFolderMenu, onWorkspaceMenu, onDeleteMaterial, onAddFile,
  onRecord, onPickUp, blockClick, draggingId, dragging = false,
}) {
  const folder = data.current_folder;
  const lectures = data.workspaces ?? [];
  const files = data.materials ?? [];
  const empty = lectures.length === 0;

  return (
    <main className="screen">
      <header className={`head ${empty ? 'titled' : ''}`}>
        <IconButton name="back" label="Back to folders" variant="plain" onClick={onBack} />
        {empty && <h1 className="head-name">{folder.name}</h1>}
        <IconButton name="more" label={`Options for ${folder.name}`} variant="plain" onClick={() => onFolderMenu(folder)} />
      </header>

      {!empty && (
        <>
          <div className="page-title">
            <h1>{folder.name}</h1>
            <p>{countLabel(lectures.length)}</p>
          </div>

          <button type="button" className="btn primary wide new-recording" onClick={onRecord}>
            <Icon name="plus" />New Recording
          </button>
        </>
      )}

      {lectures.length > 0
        ? <ul className="recording-rows section">
            {lectures.map((workspace) => (
              <RecordingRow
                key={workspace.id}
                title={workspace.title}
                lecture={{ created_at: workspace.updated_at, duration_seconds: workspace.duration_seconds }}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onMenu={() => onWorkspaceMenu(workspace)}
                onPickUp={(event) => onPickUp(event, workspace)}
                blockClick={blockClick}
                dragging={draggingId === workspace.id}
              />
            ))}
          </ul>
        : <EmptyState
            icon={folder.icon}
            title="No recordings yet"
            body="Tap the record button to capture something great."
          />}

      {files.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Files</h2>
            <button onClick={onAddFile}>Add file</button>
          </div>
          <FileList materials={files} onDelete={onDeleteMaterial} />
        </section>
      )}
      {/* The way out. There is no other folder on this screen to drop onto, so
          the target appears only while something is being carried. */}
      {dragging && (
        <div className="drop-out" data-drop="general">
          <Icon name="archive" />
          <span>Drop here to move out of {folder.name}</span>
        </div>
      )}
    </main>
  );
}
