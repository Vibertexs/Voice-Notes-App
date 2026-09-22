import { useCallback, useEffect, useRef, useState } from 'react';
import ActionSheet from './ActionSheet';
import FileList from './FileList';
import FlashcardDeck from './FlashcardDeck';
import { Icon } from './Icon';
import PlaybackControls, { SPEEDS } from './PlaybackControls';
import RecordingRow from './RecordingRow';
import RecordingSheet from './RecordingSheet';
import StudyPanel from './StudyPanel';
import SyncedTranscript from './SyncedTranscript';
import WaveScrubber from './WaveScrubber';
import { IconButton } from './ui';
import { libraryApi } from '../lib/api';
import { dateLabel, mmss } from '../lib/format';

/** A bookmark this close to the playhead counts as the one you are on. */
const MARKER_GRAB_SECONDS = 2.5;

/**
 * Playing a recording back.
 *
 * The transcript has the screen and the controls sit under it, because what
 * you came back for is what was said, not the file. Everything that is not
 * playing or reading - renaming, moving, sharing, notes - is one sheet away
 * rather than a row of buttons competing with the words.
 */
export default function PlaybackScreen({
  workspace, folders = [], onBack, onContinue, onReload, onDelete,
  onToggleFavourite, onPickFile, notify, pendingSeek, onSeekHandled,
}) {
  const [sheet, setSheet] = useState(null); // options | transcript | notes | takes
  const [selectedId, setSelectedId] = useState(workspace.sessions[0]?.id ?? null);
  const [notes, setNotes] = useState(workspace.note_body ?? '');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [busy, setBusy] = useState('');
  const audioRef = useRef(null);
  const scrubRef = useRef(false);
  const resumeRef = useRef(false);

  const selected = workspace.sessions.find((session) => session.id === selectedId) ?? workspace.sessions[0];
  const status = selected?.transcription_status;
  // Older recordings predate Whisper's word-level timings. Their lines still
  // play and seek correctly, but rebuilding once replaces the estimate with
  // the exact timing used to light each word.
  const needsPreciseTiming = Boolean(selected?.segments?.some(
    (segment) => !Array.isArray(segment.words) || segment.words.length === 0,
  ));
  const statusCopy = ['ready', 'complete'].includes(status) ? ''
    : status === 'failed' ? 'Transcript failed'
      : status === 'unavailable' ? 'No transcript'
        : `Transcribing · ${Math.round((selected?.transcription_progress ?? 0) * 100)}%`;
  const marker = selected?.markers?.find((item) => Math.abs(item.time_seconds - position) < MARKER_GRAB_SECONDS);

  useEffect(() => {
    setNotes(workspace.note_body ?? '');
    setSelectedId((current) => (workspace.sessions.some((session) => session.id === current)
      ? current
      : workspace.sessions[0]?.id ?? null));
  }, [workspace]);

  // Only poll while something is actually being transcribed.
  useEffect(() => {
    if (!workspace.sessions.some((session) => ['pending', 'running'].includes(session.transcription_status))) return undefined;
    const timer = window.setInterval(onReload, 3000);
    return () => window.clearInterval(timer);
  }, [workspace, onReload]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIndex]; }, [speedIndex, selected?.id]);
  useEffect(() => { setPosition(0); setDuration(selected?.duration_seconds ?? 0); }, [selected?.id, selected?.duration_seconds]);

  // A search result asked to open at a moment rather than at the start.
  useEffect(() => {
    if (!pendingSeek?.lectureId || pendingSeek.lectureId !== selected?.id || !audioRef.current) return;
    const player = audioRef.current;
    const apply = () => { player.currentTime = pendingSeek.seconds; player.play().catch(() => {}); };
    if (player.readyState >= 1) apply(); else player.addEventListener('loadedmetadata', apply, { once: true });
    onSeekHandled?.();
  }, [pendingSeek, selected?.id, onSeekHandled]);

  // While playing, read the clock every frame rather than waiting for
  // `timeupdate`: the spec throttles that event to about 4Hz, which is a
  // quarter of a second of drift between a word being said and being lit.
  // `timeupdate` stays as the fallback for a backgrounded tab, where frames
  // stop arriving but the audio keeps going.
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const follow = () => {
      const player = audioRef.current;
      if (player && !scrubRef.current) setPosition(player.currentTime);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = useCallback((seconds) => {
    const player = audioRef.current;
    if (!player) return;
    player.currentTime = Math.max(0, Math.min(duration || Infinity, seconds));
    setPosition(player.currentTime);
  }, [duration]);
  function togglePlay() {
    const player = audioRef.current;
    if (!player) return;
    if (player.paused) player.play().catch(() => notify('That audio is not on this device.', 'error'));
    else player.pause();
  }
  function startScrub() {
    const player = audioRef.current;
    scrubRef.current = true;
    resumeRef.current = Boolean(player && !player.paused);
    if (resumeRef.current) player.pause();
  }
  function finishScrub(seconds) {
    const player = audioRef.current;
    const target = Math.max(0, Math.min(duration || Infinity, seconds ?? position));
    setPosition(target);
    if (player) player.currentTime = target;
    scrubRef.current = false;
    if (resumeRef.current) player?.play().catch(() => {});
    resumeRef.current = false;
  }

  async function toggleMarker() {
    if (!selected) return;
    try {
      if (marker) {
        await libraryApi.deleteMarker(selected.id, marker.id);
        notify('Bookmark removed.');
      } else {
        await libraryApi.addMarker(selected.id, { label: `Bookmark at ${mmss(position)}`, time_seconds: position });
        notify(`Bookmarked ${mmss(position)}.`);
      }
      onReload();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  async function saveNotes() {
    setBusy('notes');
    try { await libraryApi.saveNotes(workspace.id, notes); notify('Notes saved.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
    finally { setBusy(''); }
  }

  async function retranscribe() {
    setBusy('transcribe');
    try { await libraryApi.retranscribe(selected.id); notify('Rebuilding precise word timing.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
    finally { setBusy(''); }
  }

  const when = selected ? dateLabel(selected.created_at) : '';
  const runtime = duration ? mmss(duration) : '';
  const subtitle = [when, runtime].filter(Boolean).join(' · ');

  return (
    <main className="play-screen">
      <header className="head">
        <IconButton name="back" label="Back" variant="plain" onClick={onBack} />
        <div className="head-actions">
          <IconButton
            name={workspace.favorite ? 'heartOn' : 'heart'}
            label={workspace.favorite ? 'Remove from favourites' : 'Add to favourites'}
            variant={`plain ${workspace.favorite ? 'on' : ''}`}
            pressed={Boolean(workspace.favorite)}
            onClick={() => onToggleFavourite(workspace)}
          />
          <IconButton name="more" label="Recording options" variant="plain" onClick={() => setSheet('options')} />
        </div>
      </header>

      <div className="page-title compact">
        <h1>{workspace.title}</h1>
        <p>{[when, runtime].filter(Boolean).join(' · ')}</p>
      </div>

      <section className="play-body">
        {selected
          ? <SyncedTranscript
              segments={selected.segments}
              currentSeconds={position}
              status={status}
              onSeek={seek}
            />
          : <div className="empty">
              <strong>No recordings yet</strong>
              <p>Record a take and the transcript will appear here.</p>
            </div>}
      </section>

      {selected && (
        <section className="play-transport" aria-label="Playback">
          <audio
            ref={audioRef}
            src={selected.audio_url}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
            onTimeUpdate={(event) => { if (!scrubRef.current) setPosition(event.currentTarget.currentTime); }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />

          <WaveScrubber
            durationSeconds={duration}
            currentSeconds={position}
            segments={selected.segments}
            markers={selected.markers}
            onScrubStart={startScrub}
            onScrub={(seconds) => { scrubRef.current = true; setPosition(seconds); }}
            onScrubEnd={finishScrub}
          />

          <div className="scrub-times">
            <span>{mmss(0)}</span>
            <span className="status">
              {statusCopy}
              {status === 'failed' && (
                <> · <button className="linkbtn" onClick={retranscribe} disabled={busy === 'transcribe'}>Retry</button></>
              )}
              {status !== 'failed' && needsPreciseTiming && (
                <button className="linkbtn" onClick={retranscribe} disabled={busy === 'transcribe'}>Improve sync</button>
              )}
            </span>
            <span>{mmss(duration)}</span>
          </div>

          <PlaybackControls
            playing={playing}
            speed={SPEEDS[speedIndex]}
            bookmarked={Boolean(marker)}
            onSpeed={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)}
            onBack15={() => seek(position - 15)}
            onToggle={togglePlay}
            onForward15={() => seek(position + 15)}
            onBookmark={toggleMarker}
          />

          <div className="play-actions">
            <button type="button" className="btn" onClick={() => setSheet('chapters')}>
              <Icon name="text" />Chapters
            </button>
            <button type="button" className="btn" onClick={() => setSheet('transcript')}>
              <Icon name="document" />Transcript
            </button>
            <button type="button" className="btn" onClick={() => setSheet('options')}>
              <Icon name="more" />More
            </button>
          </div>
        </section>
      )}

      {sheet === 'options' && (
        <RecordingSheet
          workspace={workspace}
          folders={folders}
          subtitle={subtitle}
          audioUrl={selected?.audio_url}
          notify={notify}
          onClose={() => setSheet(null)}
          onChanged={onReload}
          onDeleted={onDelete}
          onToggleFavourite={onToggleFavourite}
          extras={[
            { label: 'View Transcript', icon: 'text', keepOpen: true, onSelect: () => setSheet('transcript') },
            { label: 'Notes & study', icon: 'document', keepOpen: true, onSelect: () => setSheet('notes') },
            workspace.sessions.length > 1
              ? { label: `Takes (${workspace.sessions.length})`, icon: 'levels', chevron: true, keepOpen: true, onSelect: () => setSheet('takes') }
              : null,
            { label: 'Continue recording', icon: 'mic', onSelect: onContinue },
          ].filter(Boolean)}
        />
      )}

      {sheet === 'chapters' && (
        <ActionSheet title="Chapters" subtitle={workspace.title} onClose={() => setSheet(null)}>
          {selected?.markers?.length
            ? <div className="sheet-lines">
                {[...selected.markers].sort((a, b) => a.time_seconds - b.time_seconds).map((item) => (
                  <button key={item.id} onClick={() => { seek(item.time_seconds); setSheet(null); }}>
                    <time>{mmss(item.time_seconds)}</time>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            : <p className="dim">No chapters yet. Bookmark a moment and it will appear here.</p>}
        </ActionSheet>
      )}

      {sheet === 'takes' && (
        <ActionSheet title="Takes" subtitle={workspace.title} onClose={() => setSheet(null)}>
          <ul className="recording-rows">
            {workspace.sessions.map((session, index) => (
              <RecordingRow
                key={session.id}
                title={`Take ${workspace.sessions.length - index}`}
                lecture={session}
                onOpen={() => { setSelectedId(session.id); setSheet(null); }}
              />
            ))}
          </ul>
        </ActionSheet>
      )}

      {sheet === 'transcript' && (
        <ActionSheet title="Transcript" subtitle={workspace.title} onClose={() => setSheet(null)}>
          {selected?.segments?.length
            ? <div className="sheet-lines">
                {selected.segments.map((segment, index) => (
                  <button
                    key={`${segment.start_seconds}-${index}`}
                    onClick={() => { seek(segment.start_seconds ?? 0); setSheet(null); }}
                  >
                    <time>{mmss(segment.start_seconds ?? 0)}</time>
                    <span>{segment.text}</span>
                  </button>
                ))}
              </div>
            : <p className="dim">{statusCopy || 'No speech was recognised in this recording.'}</p>}
        </ActionSheet>
      )}

      {sheet === 'notes' && (
        <ActionSheet title="Notes & study" subtitle={workspace.title} onClose={() => setSheet(null)}>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Notes</h2>
              <button className="linkbtn" onClick={saveNotes} disabled={busy === 'notes'}>
                {busy === 'notes' ? 'Saving…' : 'Save'}
              </button>
            </div>
            <textarea
              className="field"
              value={notes}
              maxLength="100000"
              placeholder="Capture the ideas you want to remember…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </section>

          {selected?.markers?.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">Bookmarks</h2></div>
              <div className="marks">
                {selected.markers.map((item) => (
                  <span key={item.id} className="mark">
                    <button onClick={() => { seek(item.time_seconds); setSheet(null); }}>
                      {mmss(item.time_seconds)} · {item.label}
                    </button>
                    <button
                      className="mark-x"
                      onClick={async () => {
                        try { await libraryApi.deleteMarker(selected.id, item.id); onReload(); }
                        catch (caught) { notify(caught.message, 'error'); }
                      }}
                      aria-label={`Remove ${item.label}`}
                    >×</button>
                  </span>
                ))}
              </div>
            </section>
          )}

          <FlashcardDeck workspace={workspace} onReload={onReload} notify={notify} />
          <StudyPanel workspace={workspace} onReload={onReload} notify={notify} />

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Files</h2>
              <button className="linkbtn" onClick={() => onPickFile({ workspaceId: workspace.id })}>Add file</button>
            </div>
            <FileList
              materials={workspace.materials}
              onDelete={async (material) => {
                if (!window.confirm(`Delete ${material.original_filename}?`)) return;
                try { await libraryApi.deleteMaterial(material.id); onReload(); }
                catch (caught) { notify(caught.message, 'error'); }
              }}
            />
          </section>
        </ActionSheet>
      )}
    </main>
  );
}
