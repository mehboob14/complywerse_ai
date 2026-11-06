'use client';

// The SidePanel's mode for the window as it is now (see sidePanelModel.ts), kept current while the window is resized.
// useSyncExternalStore: the server (and a hydration pass) answers 'overlay', which draws nothing on the server (an overlay is a portal), and the browser
// answers from matchMedia before it paints. Without matchMedia (an old browser) the answer stays 'overlay'.
import { useCallback, useSyncExternalStore } from 'react';
import { panelModeFromMatches, panelQueries, type PanelMode } from './sidePanelModel';

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export function usePanelMode(dockFrom: number): PanelMode {
  const { dock, overlay } = panelQueries(dockFrom);
  const subscribe = useCallback((onChange: () => void) => {
    if (!canMatch()) return () => {};
    const lists: MediaQueryList[] = [window.matchMedia(overlay)];
    if (dock) lists.push(window.matchMedia(dock));
    lists.forEach((q) => q.addEventListener('change', onChange));
    return () => lists.forEach((q) => q.removeEventListener('change', onChange));
  }, [dock, overlay]);
  const snapshot = useCallback((): PanelMode => {
    if (!canMatch()) return 'overlay';
    return panelModeFromMatches(dock ? window.matchMedia(dock).matches : false, window.matchMedia(overlay).matches);
  }, [dock, overlay]);
  return useSyncExternalStore(subscribe, snapshot, () => 'overlay');
}
