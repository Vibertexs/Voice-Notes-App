import { Icon } from './Icon';

/**
 * Mobile transcription is deliberately self-contained. The only network use
 * is an optional one-time download of Whisper's model; no audio is uploaded.
 */
export default function SettingsDialog({ onClose }) {
  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>Transcription</h2>
          <button className="iconbtn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <p className="muted" style={{ marginBottom: '.75rem' }}>
          Transcripts are made privately on this phone with Whisper Base English.
          Your recordings are never sent to a server.
        </p>
        <p className="dim" style={{ fontSize: '.78rem', lineHeight: 1.45 }}>
          The first transcript downloads the approximately 60 MB speech model once. After that,
          recording and transcription work offline.
        </p>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
