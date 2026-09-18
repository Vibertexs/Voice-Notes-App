import FileList from './FileList';
import RecordingRow from './RecordingRow';
import { EmptyState, IconButton } from './ui';
import { countLabel } from '../lib/format';

/**
 * What is inside a folder.
 *
 * The same objects as the home screen, one level down: the folder's name, how
 * much is in it, and its recordings as rows. There is no record button on this
 * screen because the one in the navigation already records into whichever
 * folder is open - a second one would be the same action twice.
 */
export default function FolderScreen({
  data, onBack, onOpenWorkspace, onFolderMenu, onWorkspaceMenu, onDeleteMaterial, onAddFile,
}) {
  const folder = data.current_folder;
  const lectures = data.workspaces ?? [];
  const files = data.materials ?? [];

  return (
    <main className="screen">
      <header className="head">
        <IconButton name="back" label="Back to folders" variant="plain" onClick={onBack} />
        <IconButton name="more" label={`Options for ${folder.name}`} onClick={() => onFolderMenu(folder)} />
      </header>

      <div className="page-title">
        <h1>{folder.name}</h1>
        <p>{countLabel(lectures.length)}</p>
      </div>

      {lectures.length > 0
        ? <ul className="recording-rows section">
            {lectures.map((workspace) => (
              <RecordingRow
                key={workspace.id}
                title={workspace.title}
                lecture={{ created_at: workspace.updated_at, duration_seconds: workspace.duration_seconds }}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onMenu={() => onWorkspaceMenu(workspace)}
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
    </main>
  );
}
