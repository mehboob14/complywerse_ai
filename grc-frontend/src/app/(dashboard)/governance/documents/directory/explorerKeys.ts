// The keyboard of the Directory, apart from React so `node --test` can pin it (explorerKeys.test.ts): the Explorer shortcuts, how an arrow key moves the selection in the
// contents (a grid in Icons, a list in Details), a letter jumping to the next name that starts with it. The tree keeps its own keys (directoryModel.treeKey).
//
//   Back          Backspace, Alt+Left        Forward  Alt+Right        Up  Alt+Up
//   Open          Enter                      Properties  Alt+Enter     Edit details (rename)  F2        Deactivate  Delete
//   Move          arrows (a grid: Up and Down go a row), Home, End, a letter

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

/** Where an arrow key (or Home, End) takes the selection among `count` items drawn `columns` to a row (1: a list). `at` is the selected index, -1 for none (the first key goes to
 *  the first item). null: the key does nothing here (a Left in a list, an Up on the first row, an Up or Down past the end). */
export function moveSelection(count: number, at: number, key: string, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const last = count - 1;
  const row = (i: number) => Math.floor(i / cols);
  if (at < 0) return ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home'].includes(key) ? 0 : key === 'End' ? last : null;
  switch (key) {
    case 'Home': return at === 0 ? null : 0;
    case 'End': return at === last ? null : last;
    case 'ArrowLeft': return cols > 1 && at > 0 ? at - 1 : null;
    case 'ArrowRight': return cols > 1 && at < last ? at + 1 : null;
    case 'ArrowUp': return at - cols >= 0 ? at - cols : null;
    case 'ArrowDown':
      if (at + cols <= last) return at + cols;
      return row(at) < row(last) ? last : null;                  // the row below is a short one: its last item
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
