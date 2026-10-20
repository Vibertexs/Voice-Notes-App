import { Share } from 'react-native';

/**
 * Opens the phone's own share sheet, for the page's "Share audio" and "Share transcript".
 *
 * Text goes through React Native's Share, which needs nothing native beyond what the app
 * already has. A file is different: Android will not hand another app a raw path, it needs
 * a content:// address made by a FileProvider, which expo-sharing sets up. That is a native
 * module, so a build that predates it simply cannot share audio; the page is told so in
 * words instead of the app crashing (the module is loaded on first use, inside a try).
 */

/** True when `uri` is the directory itself or inside it. The page can only share what the app records. */
export function isInside(uri, directory) {
  const base = String(directory ?? '').replace(/\/+$/, '');
  const path = String(uri ?? '');
  return Boolean(base) && path.startsWith(`${base}/`) && !path.includes('/../');
}

export async function shareText({ title, text }) {
  const message = String(text ?? '').trim();
  if (!message) throw new Error('There is nothing to share yet.');
  await Share.share({ title: title || undefined, message });
}

export async function shareAudio({ uri, title, allowedDirectory }) {
  if (!isInside(uri, allowedDirectory)) throw new Error('That audio is not on this phone.');
  let Sharing;
  try {
    // eslint-disable-next-line global-require
    Sharing = require('expo-sharing');
  } catch {
    throw new Error('Sharing audio needs the latest version of the app. Update it and try again.');
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(uri, {
    mimeType: 'audio/wav',
    dialogTitle: title || 'Share recording',
    UTI: 'com.microsoft.waveform-audio',
  });
}
