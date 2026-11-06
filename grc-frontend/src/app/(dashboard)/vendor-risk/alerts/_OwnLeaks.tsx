'use client';

// Our own domains found in public code beside words like password or secret.
// Each file is linked, never copied; confirm it or rule it out with a reason.

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, Loader2 } from 'lucide-react';
import { vendorLeaksApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

interface Leak {
  id: number; domain: string; repository: string; path: string; url: string; first_seen: string;
  status: 'new' | 'confirmed' | 'dismissed'; note: string | null; decided_by: string | null;
}

export default function OwnLeaks() {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('vendor_risk:vendors:edit');
  const [ruling, setRuling] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['tprm-own-leaks'],
    queryFn: async () => (await vendorLeaksApi.own()).data as { items: Leak[]; switched_on: boolean },
  });
  const decide = useMutation({
    mutationFn: (v: { id: number; status: Leak['status']; note?: string }) => vendorLeaksApi.decide(v.id, { status: v.status, note: v.note }),
    onSuccess: () => { setRuling(null); setNote(''); qc.invalidateQueries({ queryKey: ['tprm-own-leaks'] }); },
  });
  if (isLoading) return null;
  const items = data?.items || [];
  if (!data?.switched_on && !items.length) {
    return (
      <p className="text-xs text-slate-500">
        To search public code for our own domains too, connect GitHub code search under{' '}
        <Link href="/admin/connectors" className="text-primary-700 hover:underline">Admin → Connectors</Link> and list the
        domains under <Link href="/vendor-risk/settings#monitoring" className="text-primary-700 hover:underline">Settings → Monitoring</Link>.
      </p>
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="own-leaks">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 id="own-leaks" className="text-sm font-semibold text-slate-900">Our own domains in public code</h2>
        <p className="text-xs text-slate-500">Files on GitHub that name one of our domains beside a word like password. Searched once a day; each is linked, not copied.</p>
      </div>
      {items.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing found.</p> : (
        <ul className="divide-y divide-slate-100">
          {items.map((l) => (
            <li key={l.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline">
                    {l.repository}/{l.path} <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="block text-xs text-slate-500">{l.domain} · found {new Date(l.first_seen).toLocaleDateString('en-GB')}
                    {l.decided_by && ` · ${l.status} by ${l.decided_by}`}{l.note && `: ${l.note}`}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] capitalize',
                    l.status === 'new' ? 'border-rose-200 bg-rose-50 text-rose-700' : l.status === 'confirmed' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-500')}>
                    {l.status === 'new' ? 'To look at' : l.status === 'confirmed' ? 'A real leak' : 'Ruled out'}
                  </span>
                  {canEdit && l.status === 'new' && (
                    <>
                      <button type="button" onClick={() => decide.mutate({ id: l.id, status: 'confirmed' })}
                        className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">It is real</button>
                      <button type="button" onClick={() => setRuling(ruling === l.id ? null : l.id)}
                        className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">Rule it out</button>
                    </>
                  )}
                  {canEdit && l.status !== 'new' && (
                    <button type="button" onClick={() => decide.mutate({ id: l.id, status: 'new' })}
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">Reopen</button>
                  )}
                </span>
              </div>
              {ruling === l.id && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); decide.mutate({ id: l.id, status: 'dismissed', note }); }}>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is not a leak" minLength={5} required
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
                  <button type="submit" disabled={decide.isPending} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">
                    {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Rule out
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
