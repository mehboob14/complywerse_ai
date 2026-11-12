// The keyboard of the folders, apart from React so `node --test` can pin it (explorerKeys.test.ts): the Explorer shortcuts and a letter jumping to the next name that starts with it. The folder rows' own keys (Right opens, Left closes) are folderKeys.ts.
//
//   Back          Backspace, Alt+Left        Forward  Alt+Right        Up  Alt+Up
//   Open          Enter                      Properties  Alt+Enter     Edit details (rename)  F2        Deactivate  Delete

/** What a shortcut asks for. */
export type ExplorerAction = 'back' | 'forward' | 'up' | 'open' | 'properties' | 'rename' | 'deactivate';

export interface KeyLike { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

/** The shortcut a key press is, or null. Ctrl, Meta and Shift combinations are the browser's and the page's own, never these. */
export function explorerShortcut(e: KeyLike): ExplorerAction | null {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.altKey) {
    switch (e.key) {
      case 'ArrowLeft': return 'back';
      case 'ArrowRight': return 'forward';
      case 'ArrowUp': return 'up';
      case 'Enter': return 'properties';
      default: return null;
    }
  }
  switch (e.key) {
    case 'Backspace': return 'back';
    case 'Enter': return 'open';
    case 'F2': return 'rename';
    case 'Delete': return 'deactivate';
    default: return null;
  }
}

// built with the constructor: the `u` flag on a literal needs an es6 target the project's tsconfig does not set
const LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{N}]', 'u');

/** A letter jumps to the next name that starts with it (after the selected one, round the list). null: no name does, or it is not a letter or digit. */
export function typeAhead(names: readonly string[], at: number, char: string): number | null {
  if (char.length !== 1 || !LETTER_OR_DIGIT.test(char)) return null;
  const c = char.toLowerCase();
  for (let step = 1; step <= names.length; step++) {
    const i = (Math.max(at, -1) + step + names.length) % names.length;
    if (names[i].trim().toLowerCase().startsWith(c)) return i === at ? null : i;
  }
  return null;
}
