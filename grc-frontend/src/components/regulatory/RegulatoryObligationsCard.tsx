'use client';

// The regulatory obligations a record is linked to, shown on that record's own
// page: which circulars reach it, clause by clause, and whether the organisation
// complies. Works for any linked record type (controls first).

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Loader2 } from 'lucide-react';
import { regulatoryApi } from '@/lib/api';

interface Item {
  link: { id: number; status: 'proposed' | 'confirmed'; source: string; rationale: string | null };
  obligation: { id: number; ref: string | null; summary: string; compliance_status: string; deadline: string | null };
  change: { id: number; title: string; source: string; status: string };
}

const TONE: Record<string, string> = {
  compliant: 'bg-emerald-50 text-emerald-700', partially_compliant: 'bg-amber-50 text-amber-800',
  non_compliant: 'bg-rose-50 text-rose-700', not_applicable: 'bg-slate-50 text-slate-500',
};
const words = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function useRegulatoryLinks(targetType: string, target: { id?: number; ref?: string }) {
  return useQuery({
    queryKey: ['regulatory-links-for', targetType, target.id ?? target.ref],
    enabled: target.id !== undefined || !!target.ref,
    queryFn: async () => ((await regulatoryApi.linksFor({ target_type: targetType, target_id: target.id,
      target_ref: target.id === undefined ? target.ref : undefined })).data?.items || []) as Item[],
  });
}

export default function RegulatoryObligationsCard({ targetType, targetId, targetRef, noun = 'record' }: {
  targetType: string; targetId?: number; targetRef?: string; noun?: string;
}) {
  const { data, isLoading } = useRegulatoryLinks(targetType, { id: targetId, ref: targetRef });
  if (isLoading) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const items = data || [];
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        No regulatory obligation is linked to this {noun}. Link one from the circular&apos;s Obligations tab.
      </p>
    );
  }
  const byChange = new Map<number, Item[]>();
  for (const it of items) byChange.set(it.change.id, [...(byChange.get(it.change.id) || []), it]);
  return (
    <div className="space-y-3">
      {Array.from(byChange.values()).map((group) => (
        <section key={group[0].change.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <Link href={`/governance/regulatory-changes/${group[0].change.id}?tab=obligations`}
            className="flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-primary-700">
            <Landmark className="h-4 w-4 text-slate-400" /> {group[0].change.title}
            <span className="text-xs font-normal text-slate-500">{group[0].change.source} · {words(group[0].change.status)}</span>
          </Link>
          <ul className="mt-2 space-y-1.5">
            {group.map((it) => (
              <li key={it.link.id} className="flex flex-wrap items-start gap-2 text-xs">
                {it.obligation.ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{it.obligation.ref}</span>}
                <span className="min-w-0 flex-1 text-slate-800">
                  {it.obligation.summary}
                  {it.link.status === 'proposed' && <span className="ml-1.5 text-[10px] text-amber-700">suggested, not yet confirmed</span>}
                </span>
                {it.obligation.deadline && <span className="text-rose-700">Due {it.obligation.deadline}</span>}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE[it.obligation.compliance_status] || 'bg-slate-100 text-slate-700'}`}>
                  {words(it.obligation.compliance_status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
