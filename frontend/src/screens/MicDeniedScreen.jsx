import VFButton from '../components/VFButton';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';

/**
 * Where a refused microphone permission lands.
 *
 * There is no welcome screen before this: the app opens on the folders, and
 * the microphone is requested the first time someone taps record. Only a
 * refusal needs a screen of its own, because Android will not ask again and the
 * only way forward is the system settings.
 */
export default function MicDeniedScreen({ onOpenSettings, onSkip }) {
  return (
    <main className="screen onboard">
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
    </main>
  );
}
