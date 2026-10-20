import { useEffect } from 'react';

/**
 * Puts the page back where it was when the on-screen keyboard goes away.
 *
 * Focusing a field makes the browser scroll the page to keep it above the keyboard.
 * On some Android WebViews that scroll is not undone when the keyboard closes (pressing
 * Enter, say), so everything stays shifted up, off screen, until the next tap. This
 * remembers where the page was when a field took focus and restores it shortly after
 * the field loses focus - and only if nothing else has taken focus in the meantime, so
 * moving between two fields never fights the keyboard.
 */
const isField = (node) => Boolean(node) && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');

export default function useKeyboardScrollRestore() {
  useEffect(() => {
    let saved = 0;
    const timers = [];
    const onFocusIn = (event) => {
      if (!isField(event.target)) return;
      timers.splice(0).forEach(window.clearTimeout);
      saved = window.scrollY;
    };
    const onFocusOut = (event) => {
      if (!isField(event.target)) return;
      // The keyboard animates away over a few hundred ms; check after each stage of it.
      [60, 250, 600].forEach((delay) => {
        timers.push(window.setTimeout(() => {
          if (isField(document.activeElement)) return;
          if (Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
        }, delay));
      });
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      timers.forEach(window.clearTimeout);
    };
  }, []);
}
