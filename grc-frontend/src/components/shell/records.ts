// How the palette and the crumb switchers read the lists the app already has (documents, committees, meetings), as pure functions
// (`node --test src/components/shell/records.test.ts`). Nothing new is asked of the server: the answers of the existing list endpoints are only turned into rows.
// A row the shape of which is not understood is skipped, never guessed at, and every text is cut where a very long title could stretch a row.
import { formatDate, statusLabel } from '../../lib/format.ts';
import { fold } from '../../lib/navRegistry.ts';
import type { RecordHit } from './paletteModel.ts';

/** An endpoint answers a plain array or `{ items, total }`: the rows, and how many there are in all (the rows' count when it does not say). */
export function listOf(data: unknown): { items: Array<Record<string, unknown>>; total: number } {
  const raw = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [];
  const items = raw.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  const said = data && typeof data === 'object' ? Number((data as { total?: unknown }).total) : NaN;
  return { items, total: Number.isFinite(said) && said >= items.length ? said : items.length };
}

const text = (value: unknown, max = 200): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const idOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null);

export function documentHits(rows: ReadonlyArray<Record<string, unknown>>): RecordHit[] {
  return rows.flatMap((row) => {
    const id = idOf(row.id);
    const title = text(row.title);
    if (id == null || !title) return [];
    const kind = text(row.doc_type) ? statusLabel(text(row.doc_type), '') : 'Document';
    const version = text(row.current_version, 20);
    return [{ id: `d${id}`, kind: 'document' as const, label: title, sub: version ? `${kind} v${version}` : kind, href: `/governance/documents/${id}` }];
  });
}

export interface CommitteeRow { id: number; name: string }

export function committeesOf(rows: ReadonlyArray<Record<string, unknown>>): CommitteeRow[] {
  return rows.flatMap((row) => {
    const id = idOf(row.id);
    const name = text(row.name);
    return id != null && name ? [{ id, name }] : [];
  });
}

export function committeeHits(committees: readonly CommitteeRow[], query: string): RecordHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return committees
    .filter((c) => words.every((word) => fold(c.name).indexOf(word) >= 0))
    .map((c) => ({ id: `c${c.id}`, kind: 'committee' as const, label: c.name, sub: 'Committee', href: `/governance/committees/${c.id}` }));
}

/** The meetings of the committees, newest first within each committee as the server sends them, those that match the words typed (the title, the number or the committee). */
export function meetingHits(groups: ReadonlyArray<{ committee: CommitteeRow; rows: ReadonlyArray<Record<string, unknown>> }>, query: string): RecordHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return groups.flatMap(({ committee, rows }) => rows.flatMap((row) => {
    const id = idOf(row.id);
    if (id == null) return [];
    const number = text(row.meeting_number, 40);
    const title = text(row.title) || (number ? `Meeting ${number}` : 'Meeting');
    const hay = fold(`${title} ${number} ${committee.name}`);
    if (!words.every((word) => hay.indexOf(word) >= 0)) return [];
    const when = typeof row.scheduled_date === 'string' ? formatDate(row.scheduled_date) : '';
    return [{ id: `m${id}`, kind: 'meeting' as const, label: title, sub: [committee.name, number ? `Meeting ${number}` : '', when].filter(Boolean).join(' · '), href: `/governance/committees/meetings/${id}` }];
  }));
}

/** A committee's meetings as the crumb switcher lists them: "Meeting 3-004 · 12 Oct 2026", the one open marked. */
export function meetingChoices(rows: ReadonlyArray<Record<string, unknown>>, openId: number | null): Array<{ label: string; href: string; current: boolean }> {
  return rows.flatMap((row) => {
    const id = idOf(row.id);
    if (id == null) return [];
    const number = text(row.meeting_number, 40);
    const when = typeof row.scheduled_date === 'string' ? formatDate(row.scheduled_date) : '';
    return [{ label: [number ? `Meeting ${number}` : text(row.title) || 'Meeting', when].filter(Boolean).join(' · '), href: `/governance/committees/meetings/${id}`, current: id === openId }];
  });
}

export function committeeChoices(committees: readonly CommitteeRow[], openId: number | null): Array<{ label: string; href: string; current: boolean }> {
  return committees.map((c) => ({ label: c.name, href: `/governance/committees/${c.id}`, current: c.id === openId }));
}

/** The record ids in a path: the committee a committee page is about, the meeting a meeting page is about. */
export function recordIdsIn(pathname: string): { committeeId: number | null; meetingId: number | null } {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  const meeting = /^\/governance\/committees\/meetings\/(\d+)$/.exec(path);
  const committee = /^\/governance\/committees\/(\d+)$/.exec(path);
  return { committeeId: committee ? Number(committee[1]) : null, meetingId: meeting ? Number(meeting[1]) : null };
}
