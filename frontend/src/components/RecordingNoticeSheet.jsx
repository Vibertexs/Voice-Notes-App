import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';

const SEEN_KEY = 'vf.recording-notice-v1';

/** Has this person already been through the notice on this device? Storage that is unavailable means "no", so it is shown again. */
export function recordingNoticeSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; }
  catch { return false; }
}

function rememberNotice() {
  try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: shown again next time */ }
}

/**
 * Shown before the first recording on a device.
 *
 * Recording people without their permission is illegal in many places and against many
 * schools' rules, and Ekho makes recording easy. This asks for a deliberate "I understand"
 * once, in plain words, and links to the longer notice. It is a reminder and a record that
 * the person was told; it is not legal advice, and it does not decide what is lawful.
 */
export default function RecordingNoticeSheet({ open, serverUrl, onAccept, onClose }) {
  return (
    <VFBottomSheet open={open} icon="warn" title="Before you record"
      subtitle="Get permission first." onClose={onClose}>
      <p className="sheet-note account-note">
        Laws and school rules about recording vary, and many places require everyone being recorded to agree.
        You are responsible for recording lawfully. Ask your instructor, follow your school’s policy, and stop
        if anyone asks you to.
      </p>
      {serverUrl && (
        <p className="sheet-note account-note"><a className="legal-inline" href={`${serverUrl}/recording-consent`}>Read more</a></p>
      )}
      <VFButton label="I understand, start recording" onPress={() => { rememberNotice(); onAccept(); }} />
      <VFButton label="Cancel" variant="ghost" onPress={onClose} />
    </VFBottomSheet>
  );
}
