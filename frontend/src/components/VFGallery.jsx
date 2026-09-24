import { useState } from 'react';
import VFButton from './VFButton';
import VFFolderCard from './VFFolderCard';
import VFRecordingRow from './VFRecordingRow';
import VFWaveform, { placeholderLevels } from './VFWaveform';
import VFRecordButton from './VFRecordButton';
import VFSlideToCancel from './VFSlideToCancel';
import VFBottomSheet from './VFBottomSheet';
import VFSearchField from './VFSearchField';
import VFToast from './VFToast';

/**
 * TEMPORARY. Every component, every variant, on one page, so the set can be
 * checked against docs/design/voiceflow/VoiceFlow Components.dc.html without
 * navigating the app to find each one.
 *
 * Reachable at #gallery. Delete this file and its hook in main.jsx once the
 * screens are signed off.
 */

const Row = ({ title, note, children, pad }) => (
  <section className="gal-block">
    <h2>{title}{note && <em>{note}</em>}</h2>
    <div className="gal-body" style={pad ? { padding: pad } : undefined}>{children}</div>
  </section>
);

export default function VFGallery() {
  // ?sheet=check|warn|x|none-open opens one for a screenshot.
  const [sheet, setSheet] = useState(new URLSearchParams(window.location.search).get('sheet') || 'none');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(true);

  return (
    <main className="gal">
      <h1>VoiceFlow components</h1>

      <Row title="VFButton" note="primary · secondary · ghost · danger · sm · disabled · icons">
        <VFButton label="Finish Recording" />
        <VFButton label="Back to Folders" variant="secondary" />
        <VFButton label="Not now" variant="ghost" />
        <VFButton label="Delete folder" variant="danger" />
        <VFButton label="New folder" icon="plus" size="sm" full={false} />
        <VFButton label="Save" icon="check" size="sm" full={false} />
        <VFButton label="View Recording" icon="play" />
        <VFButton label="Move to folder" disabled />
      </Row>

      <Row title="VFSearchField" note="idle · focus ring · clear">
        <VFSearchField placeholder="Search recordings & transcripts" />
        <VFSearchField value={query} onChange={setQuery} placeholder="Type to see the clear button" />
      </Row>

      <Row title="VFFolderCard" note="hero · tile · row · target">
        <VFFolderCard layout="hero" title="University" count={3} color="red" onMore={() => {}} />
        <div className="gal-grid2">
          <VFFolderCard layout="tile" title="Work" count={8} color="blue" onMore={() => {}} />
          <VFFolderCard layout="tile" title="Ideas" count={1} color="violet" onMore={() => {}} />
        </div>
        <VFFolderCard layout="row" title="Inbox" count={5} color="graphite" />
        <VFFolderCard layout="row" title="Personal" count={0} color="green" />
        <div className="gal-grid3">
          <VFFolderCard layout="target" title="University" count={3} color="red" />
          <VFFolderCard layout="target" title="Work" meta="Drop to move" color="amber" active />
          <VFFolderCard layout="target" title="Inbox" meta="Current" color="graphite" disabled />
        </div>
      </Row>

      <Row title="VFRecordingRow" note="default · snippet · playing · just saved · drag · dragging">
        <ul className="gal-rows">
          <VFRecordingRow title="Lecture 1" date="Sep 16, 2026" duration="28:17" />
          <VFRecordingRow title="Study Notes" date="Sep 14, 2026" duration="12:43"
            snippet="So first we start with the basic idea of a system, and then we can look at some examples of how it behaves." />
          <VFRecordingRow title="Discussion" date="Sep 12, 2026" duration="8:32" playing progress={0.42} />
          <VFRecordingRow title="Lecture 2" date="Today" duration="04:02" highlight />
          <VFRecordingRow title="Seminar" date="Sep 9, 2026" duration="51:20" mode="drag" />
          <VFRecordingRow title="Voice memo 3" date="Sep 8, 2026" duration="01:11" mode="drag" dragging />
        </ul>
      </Row>

      <Row title="VFWaveform" note="live · playing at 45% · paused">
        <VFWaveform height={120} seed={7} />
        <VFWaveform height={96} seed={12} progress={0.45} onSeek={() => {}} />
        <VFWaveform height={72} seed={3} dim />
        <VFWaveform height={44} levels={placeholderLevels(21, 24)} />
      </Row>

      <Row title="VFRecordButton" note="idle 72 · recording 80 · paused 80">
        <div className="gal-inline">
          <VFRecordButton state="idle" />
          <VFRecordButton state="recording" />
          <VFRecordButton state="paused" />
        </div>
      </Row>

      <Row title="VFSlideToCancel" note="drag the knob past 85%">
        <VFSlideToCancel onCancel={() => {}} />
      </Row>

      <Row title="VFToast" note="success · error · info · with action">
        <div className="gal-toasts">
          <div className="vf-toast is-open"><span className="vf-toast-dot vf-toast-dot--success"><i /></span><span className="vf-toast-msg">Recording saved to University</span></div>
          <div className="vf-toast is-open"><span className="vf-toast-dot vf-toast-dot--error"><i /></span><span className="vf-toast-msg">Couldn&rsquo;t save that recording</span><button type="button" className="vf-toast-action">Retry</button></div>
          <div className="vf-toast is-open"><span className="vf-toast-dot vf-toast-dot--info"><i /></span><span className="vf-toast-msg">Moved to Work</span><button type="button" className="vf-toast-action">Undo</button></div>
        </div>
      </Row>

      <Row title="VFBottomSheet" note="check · warn · x · plain">
        <div className="gal-inline">
          <VFButton label="check" size="sm" full={false} variant="secondary" onPress={() => setSheet('check')} />
          <VFButton label="warn" size="sm" full={false} variant="secondary" onPress={() => setSheet('warn')} />
          <VFButton label="x" size="sm" full={false} variant="secondary" onPress={() => setSheet('x')} />
          <VFButton label="plain" size="sm" full={false} variant="secondary" onPress={() => setSheet('none-open')} />
        </div>
      </Row>

      <VFBottomSheet
        open={sheet === 'check'} icon="check"
        title="Finish recording?" subtitle="Save this recording to University?"
        onClose={() => setSheet('none')}
      >
        <VFButton label="Finish Recording" onPress={() => setSheet('none')} />
        <VFSlideToCancel onCancel={() => setSheet('none')} />
      </VFBottomSheet>

      <VFBottomSheet
        open={sheet === 'warn'} icon="warn"
        title="Storage almost full" subtitle="VoiceFlow is using 8.2 GB. Free up space to keep recording."
        onClose={() => setSheet('none')}
      >
        <VFButton label="Free up space" />
        <VFButton label="Keep recording" variant="secondary" onPress={() => setSheet('none')} />
      </VFBottomSheet>

      <VFBottomSheet
        open={sheet === 'x'} icon="x"
        title="Recording canceled" subtitle="Nothing was saved."
        onClose={() => setSheet('none')}
      >
        <VFButton label="Record again" />
        <VFButton label="Back to Folders" variant="secondary" onPress={() => setSheet('none')} />
      </VFBottomSheet>

      <VFBottomSheet open={sheet === 'none-open'} title="Recording" onClose={() => setSheet('none')}>
        <VFButton label="Share audio" variant="secondary" />
        <VFButton label="Share transcript" variant="secondary" />
        <VFButton label="Move to folder" variant="secondary" />
        <VFButton label="Delete" variant="danger" />
      </VFBottomSheet>

      <VFToast message="This one auto-hides after 3s" action="Undo" visible={toast}
        onHide={() => setToast(false)} onAction={() => setToast(false)} lift="edge" />
    </main>
  );
}
