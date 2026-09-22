import { useEffect, useRef, useState } from 'react';
import ActionSheet from './ActionSheet';
import Waveform from './Waveform';
import { Icon } from './Icon';
import { IconButton } from './ui';
import { libraryApi, uploadRecording } from '../lib/api';
import { clock } from '../lib/format';

/**
 * Recording.
 *
 * The screen has one job, so it has one clock, one trace and three controls:
 * bookmark, pause and finish. Pausing is deliberate: it gives the student a
 * moment to check the take before the only action that saves it appears.
 *
 * The moment words start arriving, the transcript takes the screen over and
 * the clock shrinks into the status line - what you want to see while someone
 * is talking is what they said, not how long they have been talking. The
 * chevron puts the clock back.
 *
 * Nothing here asks for a name or a note. A recording is named after the fact,
 * from its own screen, because the thing being recorded does not wait.
 */
export default function RecordScreen({ context, onSaved, onCancel, notify }) {
  const [phase, setPhase] = useState('ready'); // ready | recording | paused | saving | saved
  const [elapsed, setElapsed] = useState(0);
  const [markers, setMarkers] = useState([]);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarkDraft, setBookmarkDraft] = useState('');
  const [bookmarkAt, setBookmarkAt] = useState(0);
  const [error, setError] = useState('');
  const [liveStream, setLiveStream] = useState(null);
  const [transcript, setTranscript] = useState({ text: '', interim: '' });
  const [showLyrics, setShowLyrics] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saved, setSaved] = useState(null);

  // The native shell says what this build can actually do; a browser sets
  // neither flag and gets the browser's own behaviour. The shell corrects
  // these once it knows - an offline language pack may still be downloading -
  // so this listens rather than reading once at mount.
  const [caps, setCaps] = useState(() => (typeof window !== 'undefined' && window.__CN_CAPS__) || {});
  useEffect(() => {
    const refresh = () => setCaps({ ...(window.__CN_CAPS__ || {}) });
    window.addEventListener('cn:caps', refresh);
    return () => window.removeEventListener('cn:caps', refresh);
  }, []);
  const canPause = caps.pause !== false;
  const hasLiveTranscript = caps.transcription === true;
  // The shell says false when its binary has no recorder in it. Saying so up
  // front is better than letting the button fail when it is pressed.
  const noRecorder = caps.recorder === false;

  useEffect(() => {
    if (!hasLiveTranscript) return undefined;
    const receive = (event) => setTranscript(event.detail ?? { text: '', interim: '' });
    window.addEventListener('cn:transcript', receive);
    return () => window.removeEventListener('cn:transcript', receive);
  }, [hasLiveTranscript]);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const carriedRef = useRef(0);
  const timerRef = useRef(0);
  const bookmarkFieldRef = useRef(null);

  const destination = context.workspace ? context.workspace.title : context.folder?.name ?? null;
  const now = () => carriedRef.current + (startedAtRef.current ? performance.now() - startedAtRef.current : 0);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!bookmarkOpen) return undefined;
    const focus = window.setTimeout(() => bookmarkFieldRef.current?.focus(), 80);
    return () => window.clearTimeout(focus);
  }, [bookmarkOpen]);

  function startClock() {
    window.clearInterval(timerRef.current);
    startedAtRef.current = performance.now();
    timerRef.current = window.setInterval(() => setElapsed(now()), 100);
  }
  function stopClock() {
    carriedRef.current = now();
    startedAtRef.current = 0;
    setElapsed(carriedRef.current);
    window.clearInterval(timerRef.current);
  }

  async function start() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      setLiveStream(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunksRef.current.push(event.data); });
      recorder.addEventListener('error', () => setError('The microphone stopped unexpectedly.'));
      recorder.start(1000);
      startClock();
      setPhase('recording');
    } catch (caught) {
      const detail = String(caught?.message ?? '').trim();
      setError(detail || 'Microphone access was not granted. Allow it, then try again.');
    }
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder || !canPause) return;
    if (phase === 'recording') { recorder.pause(); stopClock(); setPhase('paused'); }
    else { recorder.resume(); startClock(); setPhase('recording'); }
  }

  function openBookmark() {
    if (phase === 'ready' || phase === 'saving') return;
    const at = Math.round(now() / 100) / 10;
    setBookmarkAt(at);
    setBookmarkDraft('');
    setBookmarkOpen(true);
  }

  function saveBookmark(event) {
    event.preventDefault();
    const label = bookmarkDraft.trim() || `Bookmark at ${clock(bookmarkAt * 1000)}`;
    setMarkers((current) => [...current, { label, time_seconds: bookmarkAt }]);
    setBookmarkOpen(false);
    setBookmarkDraft('');
    notify(`Bookmark added at ${clock(bookmarkAt * 1000)}.`);
  }

  async function finish() {
    const recorder = recorderRef.current;
    // Finishing a take is intentionally a two-step action. It prevents an
    // accidental tap while someone is still talking from turning into a
    // saved, cut-off lecture.
    if (!recorder || phase !== 'paused') return;
    // Browsers emit a chunk on the timeslice; the native shell keeps the audio
    // on disk and only emits its file token on stop. Either way the page must
    // never refuse to stop for want of a chunk - stopping a second early used
    // to do nothing at all, with the screen still saying Recording.
    const nativeDeliversOnStop = typeof window !== 'undefined' && window.__CN_NATIVE__ === true;
    setPhase('saving');
    setError('');
    stopClock();
    const finished = () => new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
    const blob = await new Promise((resolve) => {
      if (recorder.state === 'inactive') { resolve(finished()); return; }
      recorder.addEventListener('stop', () => resolve(finished()), { once: true });
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    if (!blob.size && !nativeDeliversOnStop) {
      setError('That take did not capture any audio.');
      setPhase('paused');
      return;
    }
    try {
      const recording = await uploadRecording({
        blob,
        title: '',
        captureNotes: '',
        folderId: context.workspace ? undefined : context.folder?.id,
        workspaceId: context.workspace?.id,
      });
      await Promise.all(markers.map((marker) => libraryApi.addMarker(recording.id, marker)));
      setSaved(recording);
      setPhase('saved');
    } catch (caught) {
      setError(caught.message);
      setPhase('paused');
    }
  }

  function discard() {
    window.clearInterval(timerRef.current);
    // The native recorder owns a pre-claimed local row. Its discard hook
    // deletes that row and its temporary audio instead of treating cancel as
    // a finished recording with no page open.
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      if (typeof recorderRef.current.discard === 'function') recorderRef.current.discard();
      else recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    onCancel();
  }

  function leave() {
    if (phase === 'ready' || window.confirm('Discard this recording?')) discard();
  }

  /* ---- Saved (the confirmation the board calls "Recording Saved") ---- */
  if (phase === 'saved' && saved) {
    // Say what is actually happening rather than what usually happens: the
    // accurate pass only runs where there is a transcription service, and the
    // status the save came back with is the one thing that knows.
    const queued = ['pending', 'running'].includes(saved.transcription_status);
    return (
      <main className="centred">
        <span className="saved-mark"><Icon name="check" /></span>
        <h2>Recording Saved</h2>
        <p>
          {saved.title ? <>“{saved.title}”</> : 'Your recording'} has been
          saved{destination ? <> to {destination}</> : null}.
        </p>
        {queued && (
          <p className="saved-note">
            <i />Transcribing a more accurate version now. You can keep using the app.
          </p>
        )}
        {saved.transcription_status === 'unavailable' && (
          <>
            <p className="saved-note quiet">
              Your recording is safe. No speech was detected in this take, so there is no transcript yet.
            </p>
          </>
        )}
        <div className="stack">
          <button className="btn primary wide" onClick={() => onSaved(saved.workspace_id)}>View Recording</button>
          <button className="btn wide" onClick={onCancel}>Continue</button>
        </div>
      </main>
    );
  }

  const recording = phase === 'recording';
  const words = `${transcript.text} ${transcript.interim}`.trim();
  const lyricsMode = hasLiveTranscript && showLyrics && Boolean(words);
  const stateCopy = phase === 'ready' ? 'Ready'
    : recording ? 'Recording…'
      : phase === 'paused' ? 'Paused' : 'Saving…';

  return (
    <main className="rec">
      <header className={`head ${lyricsMode ? '' : 'titled'}`}>
        <IconButton
          name={lyricsMode ? 'down' : 'close'}
          label={lyricsMode ? 'Show the timer' : 'Close'}
          variant="plain"
          onClick={lyricsMode ? () => setShowLyrics(false) : leave}
          disabled={phase === 'recording' || phase === 'paused' || phase === 'saving'}
        />
        {/* A take has no name of its own until it is saved, so the header
            carries where it is going - the recording it is being added to, or
            the folder it will land in. */}
        {!lyricsMode && <h1 className="head-name">{destination ?? 'New Recording'}</h1>}
        <IconButton name="more" label="Recording options" variant="plain" onClick={() => setSheetOpen(true)} />
      </header>

      {lyricsMode
        ? <section className="rec-lyrics">
            {/* One line, centred: what the recorder is doing and how long it
                has been doing it. The words below are what matters here. */}
            <span className={`rec-state ${recording ? '' : 'idle'}`}>
              <i />{stateCopy.replace('…', '')} · {clock(elapsed)}
            </span>
            <LiveWords text={transcript.text} interim={transcript.interim} />
          </section>
        : <section className="rec-stage">
            <div className="rec-clock">{clock(elapsed)}</div>
            <span className={`rec-state ${recording ? '' : 'idle'}`}><i />{stateCopy}</span>
            <Waveform stream={liveStream} phase={phase} className="rec-trace" />
            {error && <p className="rec-error" role="alert">{error}</p>}
          </section>}

      <section className="rec-bottom">
        {bookmarkOpen
          ? <BookmarkComposer
              at={bookmarkAt}
              value={bookmarkDraft}
              fieldRef={bookmarkFieldRef}
              onChange={setBookmarkDraft}
              onCancel={() => setBookmarkOpen(false)}
              onSubmit={saveBookmark}
            />
          : markers.length > 0 && <BookmarkRack markers={markers} />}
        {lyricsMode && <Waveform stream={liveStream} phase={phase} className="rec-trace" />}
        <div className="rec-controls">
          <span className="side-l">
            <IconButton name="bookmark" label="Add a bookmark" onClick={openBookmark} disabled={phase === 'ready' || phase === 'saving'} />
          </span>

          <span className="rec-main-control">
            <button
              type="button"
              className={`record-action ${phase === 'ready' ? 'idle' : ''}`}
              onClick={phase === 'ready' ? start : pauseOrResume}
              disabled={phase === 'saving'}
              aria-label={phase === 'ready' ? 'Start recording' : phase === 'recording' ? 'Pause recording' : 'Resume recording'}
            ><Icon name={phase === 'ready' ? 'mic' : phase === 'recording' ? 'pause' : 'play'} /></button>
            <span>{phase === 'ready' ? 'Record' : phase === 'recording' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Saving'}</span>
          </span>

          {/* Finish is always in the layout and only ever changes opacity.
              Rendering it conditionally made the row 22px taller the moment
              you paused, which shifted the whole control cluster up. */}
          <span className="side-r">
            <span className={`finish-side ${phase === 'paused' ? '' : 'hidden'}`} aria-hidden={phase !== 'paused'}>
              <IconButton
                name="stop"
                label="Finish and save recording"
                onClick={finish}
                disabled={phase !== 'paused'}
              />
              <small>Finish</small>
            </span>
          </span>
        </div>
        <p className="rec-hint">
          {noRecorder && phase === 'ready'
            ? 'This build has no recorder yet — rebuild the development client to record.'
            : phase === 'ready' ? 'Tap to record'
            : phase === 'saving' ? 'Saving your recording…'
              : phase === 'recording' ? 'Pause before you finish this recording'
                : markers.length ? `${markers.length} bookmark${markers.length === 1 ? '' : 's'} · Resume or finish`
                  : 'Paused · resume or finish'}
        </p>
        <div className={`rec-cancel-slot ${phase === 'paused' ? 'visible' : ''}`}>
          {phase === 'paused' && <SlideToCancel onCancel={discard} />}
        </div>
      </section>

      {sheetOpen && (
        <ActionSheet
          title="Recording"
          subtitle={destination ? `Saving to ${destination}` : 'Saving to your library'}
          onClose={() => setSheetOpen(false)}
          items={[
            hasLiveTranscript && !lyricsMode && words
              ? { label: 'Show live transcript', icon: 'text', onSelect: () => setShowLyrics(true) }
              : null,
            phase === 'ready' ? { label: 'Discard recording', icon: 'trash', danger: true, onSelect: leave } : null,
          ]}
        />
      )}
    </main>
  );
}

/**
 * A cancellation gesture needs intent, not a nearby destructive button.
 * The thumb has to cross the track before it fires; lifting it early simply
 * springs back. Pointer events work in the browser and inside the WebView.
 */
function SlideToCancel({ onCancel }) {
  const [progress, setProgress] = useState(0);
  const [travel, setTravel] = useState(0);
  const originRef = useRef(0);
  const firingRef = useRef(false);

  function move(event) {
    if (!originRef.current || firingRef.current) return;
    const width = Math.max(1, event.currentTarget.clientWidth - 58);
    const next = Math.max(0, Math.min(1, (event.clientX - originRef.current) / width));
    setProgress(next);
    if (next >= 0.92) {
      firingRef.current = true;
      setProgress(1);
      onCancel();
    }
  }

  function release(event) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    originRef.current = 0;
    if (!firingRef.current) setProgress(0);
  }

  return (
    <div
      className="slide-cancel"
      role="slider"
      aria-label="Slide to cancel recording"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progress * 100)}
      style={{ '--slide-progress': progress, '--slide-travel': `${travel}px` }}
      onPointerDown={(event) => {
        firingRef.current = false;
        originRef.current = event.clientX;
        setTravel(Math.max(0, event.currentTarget.clientWidth - 58));
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="slide-cancel-thumb"><Icon name="trash" /></span>
      <span>Slide to cancel</span>
    </div>
  );
}

/**
 * This sits above the transport instead of in the recording grid, so opening
 * the keyboard or pausing a take never pushes the clock, waveform, or main
 * record control. The timestamp is captured when the bookmark button is
 * pressed, not after the student has finished typing.
 */
function BookmarkComposer({ at, value, fieldRef, onChange, onCancel, onSubmit }) {
  return (
    <form className="bookmark-composer" onSubmit={onSubmit}>
      <span className="bookmark-at"><Icon name="bookmark" />{clock(at * 1000)}</span>
      <input
        ref={fieldRef}
        value={value}
        maxLength={80}
        placeholder="Add a bookmark…"
        aria-label="Bookmark label"
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="bookmark-close" onClick={onCancel} aria-label="Cancel bookmark">
        <Icon name="close" />
      </button>
      <button type="submit" className="bookmark-save">Add</button>
    </form>
  );
}

function BookmarkRack({ markers }) {
  return (
    <div className="bookmark-rack" aria-label="Recent bookmarks">
      {markers.slice(-2).reverse().map((marker, index) => (
        <span className="bookmark-chip" key={`${marker.time_seconds}-${marker.label}-${index}`}>
          <Icon name="bookmark" />
          <b>{marker.label}</b>
          <small>{clock(marker.time_seconds * 1000)}</small>
        </span>
      ))}
    </div>
  );
}

/**
 * The words, while they are being said.
 *
 * Sentence by sentence, with the same hierarchy the played-back transcript
 * has: the line being said now is white, the ones already said recede, and
 * what is still settling is dimmer still - so the eye lands on the current
 * line without anything moving. The block is anchored to the bottom, which is
 * what makes new text push the old text up rather than appear underneath it.
 */
function LiveWords({ text, interim }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [text, interim]);
  const lines = (String(text ?? '').match(/[^.!?]+[.!?]*/g) ?? []).map((line) => line.trim()).filter(Boolean);
  const current = lines.length - 1;
  return (
    <div className="transcript live" aria-live="polite">
      {lines.map((line, index) => (
        <p key={index} className={`line ${index === current ? 'active' : 'past'}`}>
          {index === current ? <span className="w on">{line}</span> : line}
        </p>
      ))}
      {interim && <p className="line future">{interim}</p>}
      <div ref={endRef} />
    </div>
  );
}
