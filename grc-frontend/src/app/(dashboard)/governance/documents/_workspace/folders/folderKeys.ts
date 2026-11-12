// The keyboard of the folder rows in the library's Folders layout, apart from React so `node --test` can pin it (folderKeys.test.ts). The folder rows are a tree among the document rows:
// ONE of them is the tab stop (the selected folder, else the first), and these keys move between them. The Explorer shortcuts (Back, Forward, Up, Properties, Edit details, Deactivate)
// are explorerKeys.explorerShortcut's; the tree's own are here: Up and Down move to the folder above and below, Right opens a closed folder and then goes to the first folder inside it,
// Left closes an open one and then goes to the folder it is in, Home and End go to the first and last folder, Enter opens the folder (goes into it) and a letter jumps to the next folder
// whose name starts with it.
import { typeAhead } from './explorerKeys.ts';

/** One folder row as the keyboard sees it: the rows that are drawn, top to bottom. */
export interface FolderLine {
  /** libraryFolders.folderKey: `d12`, or `none` */
  key: string;
  name: string;
  /** 0 for a top folder, one more for each folder it is inside */
  depth: number;
  /** there is something to show inside it (documents or folders): it has an arrow */
  expandable: boolean;
  open: boolean;
}

export type FolderKey = { focus: string } | { expand: string } | { collapse: string } | { open: string } | null;

/** The folder a line is inside: the nearest line above it that is one level up. */
export function parentLine(lines: readonly FolderLine[], at: number): FolderLine | undefined {
  for (let i = at - 1; i >= 0; i--) if (lines[i].depth < lines[at].depth) return lines[i];
  return undefined;
}

/** What a key does when the row of folder `at` has focus. null: it does nothing here (the key keeps its other meanings). */
export function folderKey(lines: readonly FolderLine[], at: string, key: string): FolderKey {
  const i = lines.findIndex((l) => l.key === at);
  if (i < 0) return null;
  const line = lines[i];
  switch (key) {
    case 'ArrowDown': return i + 1 < lines.length ? { focus: lines[i + 1].key } : null;
    case 'ArrowUp': return i > 0 ? { focus: lines[i - 1].key } : null;
    case 'Home': return i > 0 ? { focus: lines[0].key } : null;
    case 'End': return i < lines.length - 1 ? { focus: lines[lines.length - 1].key } : null;
    case 'ArrowRight':
      if (!line.expandable) return null;
      if (!line.open) return { expand: line.key };
      return lines[i + 1] && lines[i + 1].depth > line.depth ? { focus: lines[i + 1].key } : null;
    case 'ArrowLeft': {
      if (line.expandable && line.open) return { collapse: line.key };
      const parent = parentLine(lines, i);
      return parent ? { focus: parent.key } : null;
    }
    case 'Enter': return { open: line.key };
    default: {
      const to = typeAhead(lines.map((l) => l.name), i, key);
      return to === null ? null : { focus: lines[to].key };
    }
  }
}
