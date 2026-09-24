import { useCallback, useEffect, useRef, useState } from 'react';
import WaveScrubber from '../components/WaveScrubber';
import SyncedTranscript from '../components/SyncedTranscript';
import VFSearchField from '../components/VFSearchField';
import { Icon } from '../components/Icon';
import { dateLabel, mmss } from '../lib/format';
import { libraryApi } from '../lib/api';

const SPEEDS = [1, 1.5, 2];

/**
 * One recording: what was said, and the transport.
 *
 * The transcript is the screen, so the player is fixed to the bottom and
 * everything else scrolls under it. The words are set large and carry no
 * timestamps - this is for reading along while it plays, and a column of
 * numbers down the left is the one thing guaranteed to pull the eye off them.
 * Time lives on the playhead; jumping by time is what Bookmarks is for.
 *
 * Search turns the header into a field instead of pushing one in above the
 * list, because when you are looking for a word the title is not what you need
 * to see; the match count is.
 */
export default function PlaybackScreen({
  workspace, folders = [], onBack, onShare, onMore, onReload,
  notify, pendingSeek, onSeekHandled,
}) {
  const [pane, setPane] = useState('transcript');   // transcript | bookmarks
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);

  const audio = useRef(null);
  const scrubbing = useRef(false);
  const resumeAfter = useRef(false);

  const selected = workspace.sessions?.[0];
  const segments = selected?.segments ?? [];
  const markers = selected?.markers ?? [];
  const folder = folders.find((entry) => entry.id === workspace.folder_id);

  const status = selected?.transcription_status;
  const transcribing = ['pending', 'running'].includes(status);
  const here = markers.find((marker) => Math.abs((marker.time_seconds ?? 0) - position) < 3);

  useEffect(() => {
    setDuration(selected?.duration_seconds ?? 0);
    setPosition(0);
  }, [selected?.id, selected?.duration_seconds]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = SPEEDS[speed]; }, [speed, selected?.id]);

  // While playing, read the clock every frame rather than waiting for
  // `timeupdate`: the spec throttles that to about 4Hz, which is a quarter of a
  // second of drift between a word being said and being lit.
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const follow = () => {
      if (audio.current && !scrubbing.current) setPosition(audio.current.currentTime);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // A search result asked to open at a moment rather than at the start.
  useEffect(() => {
    if (!pendingSeek || !audio.current) return;
    const player = audio.current;
    const apply = () => { player.currentTime = pendingSeek.seconds ?? 0; player.play().catch(() => {}); };
    if (player.readyState >= 1) apply(); else player.addEventListener('loadedmetadata', apply, { once: true });
    if (pendingSeek.term) { setSearching(true); setTerm(pendingSeek.term); }
    onSeekHandled?.();
  }, [pendingSeek, onSeekHandled]);

  const seek = useCallback((seconds) => {
    const player = audio.current;
    const target = Math.max(0, Math.min(duration || Infinity, seconds));
    setPosition(target);
    if (player) player.currentTime = target;
  }, [duration]);

  /* ---- scrubbing ----------------------------------------------------
     Dragging pulls the recording past a fixed playhead, so the audio has to be
     held while the thumb is down and handed back where it was let go.      */
  function startScrub() {
    const player = audio.current;
    scrubbing.current = true;
    resumeAfter.current = Boolean(player && !player.paused);
    if (resumeAfter.current) player.pause();
  }
  function finishScrub(seconds) {
    const player = audio.current;
    const target = Math.max(0, Math.min(duration || Infinity, seconds ?? position));
    setPosition(target);
    if (player) player.currentTime = target;
    scrubbing.current = false;
    if (resumeAfter.current) player?.play().catch(() => {});
    resumeAfter.current = false;
  }

  async function toggleBookmark() {
    if (!selected) return;
    try {
      if (here) await libraryApi.deleteMarker(selected.id, here.id);
      else {
        await libraryApi.addMarker(selected.id, {
          label: `Bookmark at ${mmss(position)}`, time_seconds: position,
        });
      }
      notify?.(here ? 'Bookmark removed' : 'Bookmark added');
      onReload?.();
    } catch (caught) { notify?.(caught.message, 'error'); }
  }

  function openOptions() {
    onMore?.({
      audioUrl: selected?.audio_url ?? null,
      subtitle: [folder?.name, dateLabel(workspace.updated_at)].filter(Boolean).join(' · '),
      extras: [{
        icon: 'bookmark',
        label: here ? `Remove bookmark at ${mmss(here.time_seconds)}` : `Bookmark ${mmss(position)}`,
        run: toggleBookmark,
      }],
    });
  }

  const matches = term
    ? segments.filter((segment) => segment.text?.toLowerCase().includes(term.toLowerCase()))
    : [];

  return (
    <main className="screen play">
      <audio
        ref={audio}
        src={selected?.audio_url ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => { if (!scrubbing.current) setPosition(event.currentTarget.currentTime); }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />

      {searching ? (
        <header className="vf-bar">
          <button type="button" className="vf-round vf-round--plain" aria-label="Close search"
            onClick={() => { setSearching(false); setTerm(''); }}>
            <Icon name="back" strokeWidth={2.2} />
          </button>
          <VFSearchField autoFocus value={term} onChange={setTerm}
            placeholder={`Search ${workspace.title}`} />
        </header>
      ) : (
        <header className="vf-bar">
          <button type="button" className="vf-round vf-round--plain" aria-label="Back" onClick={onBack}>
            <Icon name="back" strokeWidth={2.2} />
          </button>
          <span className="vf-bar-spacer" />
          <button type="button" className="vf-round vf-round--plain" aria-label="Search transcript"
            onClick={() => { setPane('transcript'); setSearching(true); }}>
            <Icon name="search" strokeWidth={2.2} />
          </button>
          <button type="button" className="vf-round vf-round--plain" aria-label="Share" onClick={onShare}>
            <Icon name="share" strokeWidth={2.2} />
          </button>
          <button type="button" className="vf-round vf-round--plain" aria-label="Options" onClick={openOptions}>
            <Icon name="more" strokeWidth={2.2} />
          </button>
        </header>
      )}

      {searching ? (
        <p className="play-matches">
          {term
            ? `${matches.length} match${matches.length === 1 ? '' : 'es'} in ${workspace.title}`
            : `Search ${workspace.title}`}
        </p>
      ) : (
        <div className="play-head">
          <h1>{workspace.title}</h1>
          <p>{[folder?.name, dateLabel(workspace.updated_at), duration ? mmss(duration) : null]
            .filter(Boolean).join(' · ')}</p>
        </div>
      )}

      {transcribing && (
        <p className="transcript-note">
          Transcribing · {Math.round((selected?.transcription_progress ?? 0) * 100)}%
        </p>
      )}

      {(searching || pane === 'transcript') ? (
        <SyncedTranscript
          segments={segments}
          currentSeconds={position}
          status={status}
          term={term}
          markers={markers}
          onSeek={seek}
        />
      ) : (
        <section className="bookmark-list">
          {markers.length ? [...markers]
            .sort((a, b) => a.time_seconds - b.time_seconds)
            .map((marker) => (
              <button key={marker.id} type="button" className="bookmark-row"
                onClick={() => { seek(marker.time_seconds); setPane('transcript'); }}>
                <time>{mmss(marker.time_seconds)}</time>
                <span>{marker.label}</span>
              </button>
            ))
            : <p className="transcript-note">No bookmarks yet. Bookmark a moment and it appears here.</p>}
        </section>
      )}

      <div className="player">
        <WaveScrubber
          durationSeconds={duration}
          currentSeconds={position}
          segments={segments}
          markers={markers}
          onScrubStart={startScrub}
          onScrub={(seconds) => { scrubbing.current = true; setPosition(seconds); }}
          onScrubEnd={finishScrub}
        />

        <div className="player-controls">
          <button type="button" className="player-speed" aria-label="Playback speed"
            onClick={() => setSpeed((current) => (current + 1) % SPEEDS.length)}>
            {SPEEDS[speed]}&times;
          </button>
          <button type="button" className="player-skip" aria-label="Back 15 seconds"
            onClick={() => seek(position - 15)}><Icon name="back15" strokeWidth={2} /></button>
          <button type="button" className="player-play" aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              const player = audio.current;
              if (!player) return;
              if (player.paused) player.play().catch(() => notify?.('That audio is not on this device.', 'error'));
              else player.pause();
            }}>
            {playing ? <span className="player-pause"><i /><i /></span> : <Icon name="play" />}
          </button>
          <button type="button" className="player-skip" aria-label="Forward 15 seconds"
            onClick={() => seek(position + 15)}><Icon name="fwd15" strokeWidth={2} /></button>
          <button type="button" className={`player-speed${here ? ' is-on' : ''}`}
            aria-label={here ? 'Remove bookmark' : 'Add a bookmark'} onClick={toggleBookmark}>
            <Icon name={here ? 'bookmarkOn' : 'bookmark'} strokeWidth={2} />
          </button>
        </div>

        {/* The three ways out of the player, where they have always been. */}
        <div className="play-actions">
          <button type="button" className={pane === 'bookmarks' ? 'is-on' : ''}
            onClick={() => { setSearching(false); setPane('bookmarks'); }}>
            <Icon name="bookmark" strokeWidth={2} />Bookmarks
            {markers.length > 0 && <b>{markers.length}</b>}
          </button>
          <button type="button" className={pane === 'transcript' && !searching ? 'is-on' : ''}
            onClick={() => { setSearching(false); setPane('transcript'); }}>
            <Icon name="text" strokeWidth={2} />Transcript
          </button>
          <button type="button" onClick={openOptions}>
            <Icon name="more" strokeWidth={2} />More
          </button>
        </div>
      </div>
    </main>
  );
}
