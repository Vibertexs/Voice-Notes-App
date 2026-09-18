import { Icon } from './Icon';

/** Course material attached to a folder or a lecture. */
export default function FileList({ materials, onDelete }) {
  if (!materials?.length) return <p className="dim">No files here yet.</p>;
  return (
    <ul className="file-list">
      {materials.map((material) => (
        <li key={material.id} className="file">
          <span className="file-kind">{material.original_filename.split('.').at(-1)?.slice(0, 4).toUpperCase()}</span>
          <a href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer">
            <strong>{material.original_filename}</strong>
            <small>
              {Math.max(1, Math.round(material.size_bytes / 1024))} KB
              {' · '}
              {material.ai_status === 'ready' ? 'Ready' : 'Processing'}
            </small>
          </a>
          <button onClick={() => onDelete(material)} aria-label={`Delete ${material.original_filename}`}>
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  );
}
