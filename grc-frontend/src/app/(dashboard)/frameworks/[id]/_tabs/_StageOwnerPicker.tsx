'use client';

/**
 * StageOwnerPicker — assign the owner of a single journey stage to a real
 * person, team, or role that exists in the tenant (persisted on the journey via
 * PATCH /certifications/{id}/stage-owners/{n}). The static flow owner string is
 * shown only as a "Suggested:" hint.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { UserRound, Users, ShieldCheck, ChevronDown, Search, Check, X } from 'lucide-react';

type OwnerType = 'user' | 'team' | 'role';
export interface StageOwner { type: OwnerType; ref_id?: number | null; label: string; }

const TYPE_META: Record<OwnerType, { label: string; icon: typeof UserRound }> = {
  user: { label: 'People', icon: UserRound },
  team: { label: 'Teams', icon: Users },
  role: { label: 'Roles', icon: ShieldCheck },
};

export default function StageOwnerPicker({
  journeyId, stageN, suggested, current,
}: {
  journeyId: number;
  stageN: number;
  suggested?: string;
  current?: StageOwner | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OwnerType>('user');
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  // Position the (portaled) menu next to the button, flipping upward when there
  // isn't room below — so it's never clipped by the stage card's overflow.
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const MENU_H = 340;
    const openUp = window.innerHeight - r.bottom < MENU_H && r.top > MENU_H;
    const left = Math.min(r.left, window.innerWidth - 300);
    setCoords(openUp
      ? { left, bottom: window.innerHeight - r.top + 6 }
      : { left, top: r.bottom + 6 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScrollResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onScrollResize);
    window.addEventListener('scroll', onScrollResize, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
    };
  }, [open]);

  const usersQ = useQuery({
    queryKey: ['stage-owner-users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data as any[],
    enabled: open, staleTime: 300_000, retry: false,
  });
  const teamsQ = useQuery({
    queryKey: ['stage-owner-teams'],
    queryFn: async () => (await apiClient.get('/admin/teams')).data as any[],
    enabled: open, staleTime: 300_000, retry: false,
  });
  const rolesQ = useQuery({
    queryKey: ['stage-owner-roles'],
    queryFn: async () => (await apiClient.get('/admin/roles')).data as any[],
    enabled: open, staleTime: 300_000, retry: false,
  });

  const setOwner = useMutation({
    mutationFn: (a: StageOwner | null) =>
      apiClient.patch(
        `/certifications/${journeyId}/stage-owners/${stageN}`,
        a ? { owner_type: a.type, ref_id: a.ref_id, label: a.label } : { owner_type: null }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certification', journeyId] });
      setOpen(false);
      setSearch('');
    },
  });

  const items: { id: number; label: string }[] =
    tab === 'user'
      ? (usersQ.data || []).map((u) => ({ id: u.id, label: u.display_name || u.name || u.email || `User #${u.id}` }))
      : tab === 'team'
      ? (teamsQ.data || []).map((t) => ({ id: t.id, label: t.name || `Team #${t.id}` }))
      : (rolesQ.data || []).map((r) => ({ id: r.id, label: r.name || `Role #${r.id}` }));
  const filtered = items.filter((it) => !search || it.label.toLowerCase().includes(search.toLowerCase()));
  const loading =
    (tab === 'user' && usersQ.isFetching) ||
    (tab === 'team' && teamsQ.isFetching) ||
    (tab === 'role' && rolesQ.isFetching);

  const CurIcon = current ? TYPE_META[current.type].icon : UserRound;

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-2">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
          current
            ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
            : 'border-dashed border-slate-300 text-slate-500 hover:border-primary-300 hover:text-primary-700'
        }`}
      >
        <CurIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
        {current ? current.label : 'Assign owner'}
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </button>

      {suggested && <span className="text-[11px] text-slate-400">Suggested: {suggested}</span>}

      {open && coords && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: coords.left, top: coords.top, bottom: coords.bottom }}
          className="z-[60] w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex rounded-lg bg-slate-50 p-0.5">
            {(Object.keys(TYPE_META) as OwnerType[]).map((t) => {
              const M = TYPE_META[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setSearch(''); }}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    tab === t ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <M.icon className="h-3.5 w-3.5" strokeWidth={1.9} /> {M.label}
                </button>
              );
            })}
          </div>

          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TYPE_META[tab].label.toLowerCase()}`}
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="max-h-52 overflow-y-auto">
            {loading ? (
              <p className="px-2 py-3 text-center text-[11px] text-slate-400">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-slate-400">Nothing found.</p>
            ) : (
              filtered.map((it) => {
                const active = current?.type === tab && current?.ref_id === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setOwner.mutate({ type: tab, ref_id: it.id, label: it.label })}
                    disabled={setOwner.isPending}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-50 ${
                      active ? 'bg-primary-50' : ''
                    }`}
                  >
                    <span className="truncate text-slate-700">{it.label}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary-600" />}
                  </button>
                );
              })
            )}
          </div>

          {current && (
            <button
              type="button"
              onClick={() => setOwner.mutate(null)}
              disabled={setOwner.isPending}
              className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Clear owner
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
