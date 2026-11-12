// The files of the Directory, apart from React so `node --test` can pin them (directoryFiles.test.ts): the documents filed in a folder, shown after its folders as Explorer does.
// The rows are the library's own lean list (one request, already cut to what the person may read; the Directory adds no permission rule of its own), narrowed here to one folder:
// a document is filed in the unit it names as its department, a document with none is filed at the top (the Organisation). Archived documents are left out, as the folder
// counts leave them out. Folders first, then files, each group by name unless a Details column is sorted; a long list shows its first FILE_PAGE rows and "Show more".
// Opening a file is the document's own page, where the library opens it (`/governance/documents/<id>`); the library is the other way in (filtered to the unit).
import { EMPTY, formatDate } from '../../../../../lib/format.ts';
import { withFrom } from '../../../../../components/shell/withFrom.ts';
import { NO_DEPARTMENT } from '../_workspace/library.ts';
import { STAGE_ORDER, statusLabel, typeLabel } from '../_workspace/libraryModel.ts';
import { documentStatus, type Tone } from '../../../../../lib/status.ts';
import type { SortState } from '../../../../../components/ui/ds/tableModel.ts';
import type { DirectoryNode, DirectoryTree } from './directoryModel.ts';

// ── what a file is ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DirFile {
  id: number;
  title: string;
  /** the document's own code ("POL-003"), for the tooltip and the search of a person who knows it */
  code: string | null;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  /** "v1.2", or the dash when the row has none */
  version: string;
  owner: string | null;
  /** the next review day as the server wrote it ("2026-12-01"), null when none is set */
  review: string | null;
  /** the unit it is filed in; null: none (it is at the top) */
  department: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** "1.2" and "v1.2" are both "v1.2"; no version is the dash. */
export const versionText = (v: string | null | undefined): string => (!v ? EMPTY : v.startsWith('v') ? v : `v${v}`);

/** One row of the library's list as a file. null when it is not a document (no id or no title) or it is archived (withdrawn: the folder counts leave it out too). */
export function fileFrom(raw: unknown): DirFile | null {
  if (!isRecord(raw)) return null;
  const id = whole(raw.id);
  const title = text(raw.title);
  if (id === null || title === null) return null;
  const status = text(raw.status) ?? 'draft';
  if (status === 'archived') return null;
  const type = text(raw.doc_type) ?? 'other';
  return {
    id, title, code: text(raw.document_code), type, typeLabel: typeLabel(type), status, statusLabel: statusLabel(status),
    version: versionText(text(raw.current_version)), owner: text(raw.owner_name), review: text(raw.next_review_date), department: whole(raw.department_id),
  };
}

/** The files of a list answer (`{ items, truncated }`, or a bare array). `partial`: the answer says it does not hold every document. */
export function filesFrom(payload: unknown): { files: DirFile[]; partial: boolean } {
  const rows = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
  const files: DirFile[] = [];
  for (const row of rows) { const f = fileFrom(row); if (f) files.push(f); }
  return { files, partial: isRecord(payload) && payload.truncated === true };
}

/** The files filed directly in a folder (a unit's id; null: the Organisation, the documents with no department). The documents of the units below are in their own folders. */
export const filesIn = (files: readonly DirFile[], folder: number | null): DirFile[] => files.filter((f) => f.department === folder);

// ── sorting and the cap ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const FILE_PAGE = 100;
export type FileSortKey = 'name' | 'status' | 'type' | 'version' | 'owner' | 'review';
export type FolderSortKey = 'name' | 'level' | 'owner' | 'people' | 'documents' | 'units';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const byText = (a: string, b: string): number => collator.compare(a, b);
const sign = (sort: SortState): number => (sort?.dir === 'desc' ? -1 : 1);

/** The number a version is sorted by: "v1.10" after "v1.2", none last. */
const versionParts = (v: string): number[] | null => (/\d/.test(v) ? v.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0) : null);
function compareVersion(a: string, b: string): number {
  const x = versionParts(a); const y = versionParts(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

/** The lifecycle order the library uses (draft first, published last); a status outside it (expired, an exception) after those. */
const statusRank = (s: string): number => { const i = (STAGE_ORDER as readonly string[]).indexOf(s); return i < 0 ? STAGE_ORDER.length : i; };

/** The files by name (no sort), or by the chosen column, the direction asked for; an equal value falls back to the name, a missing one (no owner, no review date) is last either way. */
export function sortFiles(files: readonly DirFile[], sort: SortState): DirFile[] {
  const key = (sort?.key ?? 'name') as FileSortKey;
  const dir = sign(sort);
  const missing = (f: DirFile): boolean => (key === 'owner' ? !f.owner : key === 'review' ? !f.review : key === 'version' ? versionParts(f.version) === null : false);
  const value = (a: DirFile, b: DirFile): number => {
    switch (key) {
      case 'status': return statusRank(a.status) - statusRank(b.status) || byText(a.statusLabel, b.statusLabel);
      case 'type': return byText(a.typeLabel, b.typeLabel);
      case 'version': return compareVersion(a.version, b.version);
      case 'owner': return byText(a.owner ?? '', b.owner ?? '');
      case 'review': return (a.review ?? '').localeCompare(b.review ?? '');
      default: return byText(a.title, b.title);
    }
  };
  return [...files].sort((a, b) => {
    const gone = Number(missing(a)) - Number(missing(b));
    if (gone) return gone;
    return dir * value(a, b) || byText(a.title, b.title) || a.id - b.id;
  });
}

/** The units directly under a folder by name (no sort) or by the chosen column. */
export function sortFolders(nodes: readonly DirectoryNode[], tree: DirectoryTree, sort: SortState): DirectoryNode[] {
  const key = (sort?.key ?? 'name') as FolderSortKey;
  const dir = sign(sort);
  const missing = (n: DirectoryNode): boolean => key === 'owner' && !n.head;
  const value = (a: DirectoryNode, b: DirectoryNode): number => {
    switch (key) {
      case 'level': return a.level - b.level;
      case 'owner': return byText(a.head?.name ?? '', b.head?.name ?? '');
      case 'people': return a.counts.members - b.counts.members;
      case 'documents': return tree.documentsTotal(a.id) - tree.documentsTotal(b.id);
      case 'units': return tree.childrenOf(a.id).length - tree.childrenOf(b.id).length;
      default: return byText(a.name, b.name);
    }
  };
  return [...nodes].sort((a, b) => Number(missing(a)) - Number(missing(b)) || dir * value(a, b) || byText(a.name, b.name) || a.id - b.id);
}

/** The first `limit` files, and how many more there are. */
export function capFiles<T>(files: readonly T[], limit: number = FILE_PAGE): { shown: T[]; more: number } {
  return { shown: files.slice(0, Math.max(0, limit)), more: Math.max(0, files.length - Math.max(0, limit)) };
}

// ── the things a folder holds, in the order they are drawn ────────────────────────────────────────────────────────────────────────────────

/** A folder or a file, as the selection and the keyboard name it: `u:7` (a unit), `d:12` (a document). */
export type ItemKey = `u:${number}` | `d:${number}`;
export const unitKey = (id: number): ItemKey => `u:${id}`;
export const docKey = (id: number): ItemKey => `d:${id}`;
export type Item = { kind: 'unit'; id: number } | { kind: 'doc'; id: number };

export function itemOf(key: string | null | undefined): Item | null {
  const m = /^([ud]):(\d{1,9})$/.exec(key ?? '');
  return m ? { kind: m[1] === 'u' ? 'unit' : 'doc', id: Number(m[2]) } : null;
}
export const keyOf = (item: Item): ItemKey => (item.kind === 'unit' ? unitKey(item.id) : docKey(item.id));

/** The folder a selection is remembered under: `org` or the unit's id. */
export const folderKey = (folder: number | null): string => (folder === null ? 'org' : String(folder));

/** The keys of what a folder shows, folders then files. */
export const itemKeys = (units: readonly { id: number }[], files: readonly { id: number }[]): ItemKey[] => [...units.map((u) => unitKey(u.id)), ...files.map((f) => docKey(f.id))];

// ── where a file opens ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The document's own page, where the library opens a document; `from` (the Directory's address) lets that page's way back be this folder. */
export const docHref = (id: number, from?: string): string => (from ? withFrom(`/governance/documents/${id}`, from) : `/governance/documents/${id}`);

/** The library filtered to the unit the file is filed in (or to "no department"), with the document's details open. */
export const libraryFileHref = (file: Pick<DirFile, 'id' | 'department'>): string => `/governance/documents?dept=${file.department ?? NO_DEPARTMENT}&open=${file.id}`;

/** The words of a file's tooltip: its title, then what it is. */
export const fileTip = (f: DirFile): string => [f.title, [f.code, f.typeLabel, f.statusLabel, f.version === EMPTY ? null : f.version].filter(Boolean).join(' · ')].join('\n');

/** The next review day for a table cell ("1 Dec 2026"), the dash when none is set. */
export const reviewText = (f: Pick<DirFile, 'review'>): string => formatDate(f.review, { calendar: true });

/** The tone of a status, the platform's own (lib/status.ts documentStatus: the same one the status pills use): the colour of the dot on a file's icon. The word is always in the
 *  tooltip and the Details column, never the colour alone. */
export const statusTone = (status: string): Tone => documentStatus.tone(status);
