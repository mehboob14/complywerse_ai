'use client';

// The shell's mode for the window as it is now (see shellMode.ts), kept current while the window is resized.
// useSyncExternalStore: the server (and a hydration pass) answers 'docked', the browser answers from matchMedia before it paints, and a resize
// re-renders with the new answer. Without matchMedia (an old browser) the shell stays 'docked'. The shell is mounted by the dashboard layout after
// AuthGuard has run in the browser, never on the server, so the first paint already has the right answer.
import { useSyncExternalStore } from 'react';
import { DOCK_QUERY, RAIL_QUERY, shellModeFromMatches, type ShellMode } from './shellMode';

const queries = () => [window.matchMedia(DOCK_QUERY), window.matchMedia(RAIL_QUERY)];
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => {};
  const list = queries();
  list.forEach((q) => q.addEventListener('change', onChange));
  return () => list.forEach((q) => q.removeEventListener('change', onChange));
}

function snapshot(): ShellMode {
  if (!canMatch()) return 'docked';
  const [dock, rail] = queries();
  return shellModeFromMatches(dock.matches, rail.matches);
}

export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'docked');
}
