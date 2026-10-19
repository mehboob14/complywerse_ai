/**
 * The Edit / View switch above a document in the AI Studio. Edit is the text, for people who may save; View is the file when
 * the document has one (a Word file as Word lays it out, or the PDF as uploaded), else the text read-only, so every document
 * can be read. People who may not save see only View.
 */
import type { EditorMode } from './StudioEditor';

export type ViewKey = 'edit' | 'view';
type Source = { kind: string | null; in_place: boolean } | null | undefined;

/** What View shows. */
export function viewShows(source: Source): 'word' | 'pdf' | 'text' {
  if (source?.in_place) return 'word';
  return source?.kind === 'pdf' ? 'pdf' : 'text';
}

const VIEW_TITLE = {
  word: 'Your Word file with your changes written in, as Word lays it out',
  pdf: 'The PDF as it was uploaded',
  text: 'Read the document without changing it',
};

export function switchButtons(source: Source, maySave: boolean): { key: ViewKey; label: string; title: string }[] {
  const view = { key: 'view' as const, label: 'View', title: VIEW_TITLE[viewShows(source)] };
  return maySave ? [{ key: 'edit', label: 'Edit', title: 'Change the text; it is saved as you go' }, view] : [view];
}

/** The line above the file view. Someone who may not save has no Edit: for them it is the document as its file shows it. */
export function fileNote(source: Source, maySave: boolean): string {
  const word = viewShows(source) === 'word';
  if (!maySave) return word ? 'The document as its Word file shows it, as Word lays it out.' : 'The document as its PDF shows it, as it was uploaded.';
  return word ? 'Your Word file with your changes written in, as Word lays it out. Make changes in Edit; this follows what you save.'
    : 'The PDF as it was uploaded. A PDF cannot be edited: you change its text in Edit, and saving makes a Word copy of it.';
}

/** Whether the document opens on its file: a Word file edited in place does, and any file does for someone who may only read it. */
export function opensOnFile(source: Source, maySave: boolean): boolean {
  const shows = viewShows(source);
  return shows === 'word' || (shows === 'pdf' && !maySave);
}

/** What a click shows. View on a file keeps the editor's mode underneath (the editor is only hidden). */
export function choose(key: ViewKey, source: Source, mode: EditorMode): { mode: EditorMode; asFile: boolean } {
  if (key === 'edit') return { mode: 'edit', asFile: false };
  return viewShows(source) === 'text' ? { mode: 'view', asFile: false } : { mode, asFile: true };
}

/** The lit button for what is on screen (`mode`: the editor's mode as shown); none when the editor is read-only over a file
 * (an issue or a placeholder brought into view for someone who may not save). The caller lights none under a comparison. */
export function pressedKey(source: Source, mode: EditorMode, asFile: boolean): ViewKey | null {
  if (asFile) return 'view';
  if (mode !== 'view') return 'edit';
  return viewShows(source) === 'text' ? 'view' : null;
}
