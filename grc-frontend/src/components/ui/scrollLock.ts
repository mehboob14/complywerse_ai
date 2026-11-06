// One lock for the page's scroll, shared by every overlay that uses it (AnimatedModal, RightSlidePanel, the shell's menu drawer):
// the first to open saves the page's own value and the last to close puts it back, in whatever order they close.
// Each of them used to save and restore its own value, so closing two stacked overlays in the "wrong" order (the one opened first,
// then the one opened over it) restored 'hidden' and left the page unscrollable until a reload.
// `node --test src/components/ui/scrollLock.test.ts` runs the logic; lockBodyScroll applies it to <body>.

/** Returns a `lock()` that hides scrolling and gives back an `unlock` for that one caller (calling it twice does nothing the second time). */
export function createScrollLock(read: () => string, write: (value: string) => void): () => () => void {
  let holders = 0;
  let saved = '';
  return () => {
    if (holders++ === 0) {
      saved = read();
      write('hidden');
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--holders === 0) write(saved);
    };
  };
}

export const lockBodyScroll = createScrollLock(
  () => document.body.style.overflow,
  (value) => { document.body.style.overflow = value; },
);
