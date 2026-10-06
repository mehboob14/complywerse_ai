'use client';

/**
 * Who an assessment item is assigned to: any number of people and/or teams, ticked from one popover
 * (People | Teams). Every tick saves. One component for the rows of every assessment screen.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, UserPlus, Users } from 'lucide-react';
import apiClient, { assetsApi } from '@/lib/api';

export type Assignee = { type: 'user' | 'team'; id: number; name: string };
type Kind = Assignee['type'];

const FACE_TONES = ['bg-teal-100 text-teal-800', 'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800', 'bg-rose-100 text-rose-800', 'bg-emerald-100 text-emerald-800'];

function Face({ a }: { a: Assignee }) {
  const initials = a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span title={a.name} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white ${a.type === 'team' ? 'bg-indigo-100 text-indigo-700' : FACE_TONES[a.id % FACE_TONES.length]}`}>
      {a.type === 'team' ? <Users className="h-3 w-3" /> : initials}
    </span>
  );
}

export default function ItemAssignees({ itemId, value, onSaved, fallback, label, align = 'left' }: {
  itemId: number;
  /** The item's assignees as the server sent them. */
  value?: Assignee[] | null;
  /** Called after a save, so the screen can refetch the list the item came from. */
  onSaved?: () => void;
  /** Free text a workbook carried (a "Responsible" cell): shown, muted, until someone is assigned. */
  fallback?: string | null;
  /** What the row is, for screen readers (e.g. its number). */
  label?: string;
  /** Which edge of the trigger the list lines up with. */
  align?: 'left' | 'right';
}) {
  const [saved, setSaved] = useState<Assignee[]>(value ?? []);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Kind>('user');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; maxH: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const valueKey = JSON.stringify(value ?? []);
  useEffect(() => { if (!busy) setSaved(value ?? []); }, [valueKey]);       // eslint-disable-line react-hooks/exhaustive-deps

  const people = useQuery({
    queryKey: ['assessment-assignee-people'], enabled: open, staleTime: 5 * 60 * 1000,
    queryFn: async () => ((await assetsApi.getTenantUsers()).data || []) as Array<{ id: number; display_name: string; email?: string }>,
  });
  const teams = useQuery({
    queryKey: ['assessment-assignee-teams'], enabled: open, staleTime: 5 * 60 * 1000,
    queryFn: async () => ((await apiClient.get('/admin/teams')).data || []) as Array<{ id: number; name: string; member_count?: number }>,
  });

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    const shut = () => setOpen(false);
    // The list may scroll inside the popup; the page scrolling away from the trigger shuts it.
    const scrolled = (e: Event) => { if (!(e.target instanceof Node && pop.current?.contains(e.target))) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onKey, true);         // before a popup's own Escape closes the popup
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [open]);

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      // Open on the roomier side, and never taller than that room (the list scrolls).
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 360 && above > below;
      const left = align === 'right' ? r.right - 272 : r.left;
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - 280)), up, maxH: Math.max(180, Math.min(420, up ? above : below)) });
    }
    setQ('');
    setFailed(false);
    setOpen(true);
  };

  const save = async (next: Assignee[]) => {
    const before = saved;
    setBusy(true);
    setFailed(false);
    setSaved(next);
    try {
      const r = await apiClient.put(`/compliance/assessments/items/${itemId}/assignees`, { assignees: next.map(({ type, id }) => ({ type, id })) });
      setSaved((r.data?.assignees || []) as Assignee[]);
      onSaved?.();
    } catch {
      setSaved(before);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const has = (kind: Kind, id: number) => saved.some((a) => a.type === kind && a.id === id);
  const tick = (a: Assignee) => save(has(a.type, a.id) ? saved.filter((x) => !(x.type === a.type && x.id === a.id)) : [...saved, a]);

  const needle = q.trim().toLowerCase();
  const rows: Array<Assignee & { sub?: string }> = tab === 'user'
    ? (people.data || []).map((u) => ({ type: 'user' as const, id: u.id, name: u.display_name, sub: u.email }))
    : (teams.data || []).map((t) => ({ type: 'team' as const, id: t.id, name: t.name, sub: t.member_count != null ? `${t.member_count} member${t.member_count === 1 ? '' : 's'}` : undefined }));
  const list = rows.filter((r) => !needle || `${r.name} ${r.sub || ''}`.toLowerCase().includes(needle));
  const loading = tab === 'user' ? people : teams;
  const names = saved.map((a) => a.name).join(', ');
  const count = (kind: Kind) => saved.filter((a) => a.type === kind).length;

  return (
    <>
      <button ref={trigger} type="button" onClick={toggleOpen} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Assigned to ${names || 'no one'}${label ? ` for ${label}` : ''}. Change`}
        title={names || (fallback ? `Imported as “${fallback}”. Click to assign people or teams.` : 'Assign to people or teams')}
        className={`flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs transition-colors hover:bg-primary-50 ${open ? 'ring-2 ring-primary-500/30' : ''}`}>
        {saved.length === 0 ? (
          fallback
            ? <span className="min-w-0 truncate italic text-slate-500">{fallback}</span>
            : <span className="flex items-center gap-1.5 rounded-md border border-dashed border-[#9aa4b0] px-1.5 py-0.5 text-slate-500"><UserPlus className="h-3.5 w-3.5" /> Assign</span>
        ) : (
          <>
            <span className="flex -space-x-1.5">{saved.slice(0, 3).map((a) => <Face key={`${a.type}${a.id}`} a={a} />)}</span>
            <span className="min-w-0 truncate text-slate-800">{saved.length === 1 ? saved[0].name : `${saved[0].name.split(' ')[0]} +${saved.length - 1}`}</span>
          </>
        )}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        // Portalled out of the page, so it re-enters the platform's colour scope (outside it every slate text goes muted grey).
        <div ref={pop} role="dialog" aria-label="Assign to people or teams" onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH, transform: pos.up ? 'translateY(-100%)' : undefined }}
          className="platform-ui cw-dashboard fixed z-[9999] flex w-[17rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex shrink-0 gap-1 border-b border-slate-100 p-2">
            {([['user', 'People'], ['team', 'Teams']] as const).map(([kind, text]) => (
              <button key={kind} type="button" aria-pressed={tab === kind} onClick={() => { setTab(kind); setQ(''); }}
                className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${tab === kind ? 'bg-primary-50 font-semibold text-[#0f766e]' : 'text-slate-500 hover:bg-primary-50/60'}`}>
                {text}{count(kind) > 0 && <span className="ml-1 rounded-full bg-primary-100 px-1.5 text-[10px] font-semibold text-[#0f766e]">{count(kind)}</span>}
              </button>
            ))}
          </div>
          <div className="relative shrink-0 border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'user' ? 'Search people' : 'Search teams'}
              aria-label={tab === 'user' ? 'Search people' : 'Search teams'}
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
          </div>
          <ul className="max-h-64 min-h-0 overflow-y-auto py-1">
            {loading.isError ? <li className="px-3 py-2 text-xs text-rose-600">Couldn’t load the list. Close this and try again.</li>
              : loading.isLoading ? <li className="px-3 py-2 text-xs text-slate-500">Loading…</li>
              : list.length === 0 ? <li className="px-3 py-2 text-xs text-slate-500">
                {rows.length === 0 && tab === 'team' ? 'No teams yet. Create them under Admin → Teams.' : 'No match.'}</li>
              : list.map((r) => {
                const on = has(r.type, r.id);
                return (
                  <li key={r.id}>
                    <button type="button" role="checkbox" aria-checked={on} disabled={busy} onClick={() => tick({ type: r.type, id: r.id, name: r.name })}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-primary-50/70 disabled:opacity-60 ${on ? 'bg-primary-50' : ''}`}>
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                      <Face a={r} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-slate-800">{r.name}</span>{r.sub && <span className="block truncate text-[11px] text-slate-500">{r.sub}</span>}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
          {(failed || saved.length > 0) && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <span role="status" className="text-[11px] text-rose-600">{failed ? 'Couldn’t save. Try again.' : ''}</span>
              {saved.length > 0 && <button type="button" disabled={busy} onClick={() => save([])} className="text-[11px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-60">Unassign everyone</button>}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
