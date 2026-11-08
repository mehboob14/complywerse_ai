'use client';

// "Leave without saving?": while a page holds edits that are not saved, a click on any link that would leave it asks first (the kit's confirm dialog, not window.confirm), and closing the
// tab or reloading gets the browser's own prompt. The browser's Back button cannot be asked in the app router, so it is not covered.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function useLeaveGuard(dirty: boolean, ask: () => Promise<boolean>): void {
  const router = useRouter();
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void askRef.current().then((leave) => { if (leave) router.push(`${url.pathname}${url.search}${url.hash}`); });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, router]);
}
