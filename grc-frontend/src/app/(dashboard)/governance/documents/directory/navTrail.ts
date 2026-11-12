// Back and Forward in the Directory, apart from React so `node --test` can pin them (navTrail.test.ts). The browser's history holds the folders this page went through
// (every move to another folder is a push, so the browser's own Back and mouse buttons work); this is the small mirror of it the page keeps, to know whether there is anywhere
// to go back or forward to (the first Back from the first folder visited must not leave the Directory silently, so its button is disabled there) and which way a change of
// address went. A folder is a unit's id, or null for the Organisation.

export type Folder = number | null;
export interface Trail { stack: readonly Folder[]; at: number }

/** The most folders remembered; the oldest go first. */
export const TRAIL_MAX = 200;

export const startTrail = (folder: Folder): Trail => ({ stack: [folder], at: 0 });
export const hereOf = (t: Trail): Folder => t.stack[t.at];
export const canBack = (t: Trail): boolean => t.at > 0;
export const canForward = (t: Trail): boolean => t.at < t.stack.length - 1;

/** Going to a folder: what was ahead of here is gone (as in a browser), the folder is pushed. Going to where you already are changes nothing. */
export function visit(t: Trail, folder: Folder): Trail {
  if (hereOf(t) === folder) return t;
  const kept = [...t.stack.slice(0, t.at + 1), folder];
  const cut = Math.max(0, kept.length - TRAIL_MAX);
  return { stack: kept.slice(cut), at: kept.length - 1 - cut };
}

/** The address was replaced, not pushed (a key moved the selection in the tree; a new unit was opened): this entry now names another folder. */
export function replaceHere(t: Trail, folder: Folder): Trail {
  if (hereOf(t) === folder) return t;
  const stack = [...t.stack];
  stack[t.at] = folder;
  return { stack, at: t.at };
}

export function back(t: Trail): Trail { return canBack(t) ? { stack: t.stack, at: t.at - 1 } : t; }
export function forward(t: Trail): Trail { return canForward(t) ? { stack: t.stack, at: t.at + 1 } : t; }

/** The address changed by itself (the browser's Back or Forward, a mouse button, a link) to `folder`: which entry is it? `hint` is the direction the page asked for when it asked
 *  (its own buttons); without one the neighbour that names the folder wins, Back before Forward when both do, and a folder that is neither is a new place (a push). */
export function follow(t: Trail, folder: Folder, hint?: 'back' | 'forward' | null): Trail {
  if (hereOf(t) === folder) return t;
  const before = t.stack[t.at - 1];
  const after = t.stack[t.at + 1];
  const isBefore = canBack(t) && before === folder;
  const isAfter = canForward(t) && after === folder;
  if (hint === 'forward' && isAfter) return forward(t);
  if (hint === 'back' && isBefore) return back(t);
  if (isBefore) return back(t);
  if (isAfter) return forward(t);
  return visit(t, folder);
}
