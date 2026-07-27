'use client';

/**
 * Guide mode — in-product contextual help.
 *
 * Purely additive: when `enabled` is false, every consumer (GuideMarker,
 * GuideToggle's active styling, GuidePanel) renders nothing extra. Nothing
 * here touches scoring, data-fetching, or existing page structure — it only
 * tracks two pieces of UI state (is guide mode on, which note is open).
 *
 * Initial state: `?guide=1` in the URL turns guide mode on for that load
 * (handy for sharing a pre-guided demo link). Otherwise the last toggle
 * choice is restored from localStorage. Either way, the very first render
 * (server + first client paint) is always "off" to avoid a hydration
 * mismatch — the real value is applied a tick later from an effect.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type GuideContextValue = {
  enabled: boolean;
  activeId: string | null;
  toggle: () => void;
  select: (id: string | null) => void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

const STORAGE_KEY = 'complyverse.guideMode.enabled';

export function GuideProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Resolve initial state on mount only (browser-only APIs).
  useEffect(() => {
    let initial = false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('guide') === '1') {
        initial = true;
      } else {
        initial = window.localStorage.getItem(STORAGE_KEY) === '1';
      }
    } catch {
      initial = false;
    }
    if (initial) setEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore — persistence is best-effort */
      }
      if (!next) setActiveId(null);
      return next;
    });
  }, []);

  const select = useCallback((id: string | null) => {
    setActiveId(id);
  }, []);

  const value = useMemo(
    () => ({ enabled, activeId, toggle, select }),
    [enabled, activeId, toggle, select]
  );

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

/**
 * Safe to call from anywhere, even outside a GuideProvider — falls back to
 * a fully-disabled, no-op value so a stray marker never throws.
 */
export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    return { enabled: false, activeId: null, toggle: () => {}, select: () => {} };
  }
  return ctx;
}
