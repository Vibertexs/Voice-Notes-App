import VFButton from '../components/VFButton';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';

/**
 * First run, and the one branch off it.
 *
 * `denied` is the handoff's second screen rather than a separate component,
 * because it is the same screen after a different answer: same lockup, same
 * two buttons, different reason for being here. Splitting them would mean
 * maintaining one layout twice.
 *
 * The three feature lines are the only copy on these screens the handoff does
 * not specify; everything else comes from COPY.
 */

const FEATURES = [
  { icon: 'mic', title: 'Record anything', body: 'Lectures, meetings, the thought you had on the way home.' },
  { icon: 'text', title: 'Transcribed on the phone', body: 'The audio never leaves the device. No account, no upload.' },
  { icon: 'search', title: 'Find what was said', body: 'Search inside every recording, not just their names.' },
];

export default function OnboardingScreen({ denied = false, onAllow, onOpenSettings, onSkip }) {
  return (
    <main className="screen onboard">
      {denied ? (
        <>
          <span className="onboard-mark onboard-mark--off"><Icon name="micOff" strokeWidth={2} /></span>
          <h1>{COPY.micTitle}</h1>
          <p className="onboard-tagline">{COPY.micSub}</p>
          <ol className="onboard-path">
            <li>Open Settings</li>
            <li>Apps &rsaquo; VoiceFlow &rsaquo; Permissions</li>
            <li>Turn on Microphone</li>
          </ol>
          <div className="onboard-actions">
            <VFButton label="Open Settings" onPress={onOpenSettings} />
            <VFButton label={COPY.later} variant="ghost" onPress={onSkip} />
          </div>
        </>
      ) : (
        <>
          <span className="onboard-mark"><Icon name="mic" strokeWidth={2} /></span>
          <h1>VoiceFlow</h1>
          <p className="onboard-tagline">{COPY.tagline}</p>
          <ul className="onboard-features">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="onboard-feature-icon"><Icon name={feature.icon} strokeWidth={2} /></span>
                <span>
                  <strong>{feature.title}</strong>
                  <small>{feature.body}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="onboard-actions">
            <VFButton label={COPY.allow} onPress={onAllow} />
            <VFButton label={COPY.later} variant="ghost" onPress={onSkip} />
          </div>
        </>
      )}
    </main>
  );
}
