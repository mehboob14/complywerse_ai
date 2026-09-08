'use client';

// Mapping review queue — the mechanism that makes accuracy improve instead of
// being re-measured. An audit put our authored mappings at 88% ±6pp; re-running
// it tells you the number again, it does not move it. A reviewer's decision here
// is keyed on the mapping's identity rather than its row id, so a suppression
// survives the next SCF release re-import instead of being re-litigated.
//
// The queue is ranked worst-first: lowest confidence, then fan-out (a
// requirement claiming many controls, or a control claimed by many
// requirements, is diluted either way), then material controls, where a wrong
// mapping costs the most.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CornerUpRight, Loader2, X } from 'lucide-react';
import { automationApi } from '@/lib/api';

interface QueueItem {
  source_slug: string;
  framework: string;
  requirement_code: string;
  reference: string;
  requirement_title: string | null;
  scf_id: string;
  confidence: number;
  match_mode: string;
  provenance: string;
  /** requirement fan-out + control fan-out; high means the mapping is diluted */
  fan_out: number;
  is_material: boolean;
}
interface Queue {
  release: string;
  remaining: number;
  reviewed: number;
  items: QueueItem[];
}

const identity = (i: QueueItem) => `${i.source_slug}|${i.requirement_code}|${i.scf_id}`;

function Confidence({ value }: { value: number }) {
  // 0.35 is the floor our authoring uses for a low-confidence one-hop; 1.00 is
  // code identity. Anything under 0.6 is the reason this queue exists.
  const tone =
    value >= 0.85 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : value >= 0.6 ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      {value.toFixed(2)}
    </span>
  );
}

export default function MappingReviewPage() {
  const qc = useQueryClient();
  const [framework, setFramework] = useState<string>('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [retarget, setRetarget] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery<Queue>({
    queryKey: ['mapping-review-queue', framework],
    queryFn: async () =>
      (await automationApi.getMappingReviewQueue({ framework: framework || undefined, limit: 50 })).data,
  });

  const decide = useMutation({
    mutationFn: (body: Parameters<typeof automationApi.recordMappingReview>[0]) =>
      automationApi.recordMappingReview(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mapping-review-queue'] }),
  });

  const act = (i: QueueItem, verdict: 'confirmed' | 'suppressed' | 'retargeted') => {
    const key = identity(i);
    if (verdict === 'retargeted' && !(retarget[key] || '').trim()) return;
    decide.mutate({
      source_slug: i.source_slug,
      requirement_code: i.requirement_code,
      scf_id: i.scf_id,
      verdict,
      retarget_scf_id: verdict === 'retargeted' ? retarget[key].trim() : undefined,
      note: (note[key] || '').trim() || undefined,
    });
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/automation/soc2-controls" className="text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Mapping review</h1>
          <p className="text-sm text-slate-500">
            Requirement-to-control mappings ranked worst first. Decisions persist across SCF releases.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      )}
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          Could not load the review queue.
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-600">
              <span className="font-semibold tabular-nums text-slate-900">{data.remaining.toLocaleString()}</span> unreviewed
            </span>
            <span className="text-slate-600">
              <span className="font-semibold tabular-nums text-slate-900">{data.reviewed.toLocaleString()}</span> decided
            </span>
            <span className="text-slate-400">SCF {data.release}</span>
            <input
              value={framework}
              onChange={(e) => setFramework(e.target.value.trim())}
              placeholder="filter by framework slug, e.g. sbp_etgrmf"
              className="ml-auto w-72 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>

          <div className="space-y-2">
            {data.items.map((i) => {
              const key = identity(i);
              return (
                <div key={key} className="rounded border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Confidence value={i.confidence} />
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      fan-out {i.fan_out}
                    </span>
                    {i.match_mode !== 'exact' && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700 border border-violet-200">
                        {i.match_mode}
                      </span>
                    )}
                    {i.is_material && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 border border-blue-200">
                        material
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{i.provenance}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-slate-900">{i.framework}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-sm text-slate-700">{i.reference}</span>
                    <span className="text-slate-400">→</span>
                    <Link
                      href={`/automation/soc2-controls/${encodeURIComponent(i.scf_id)}`}
                      className="font-mono text-sm text-blue-700 hover:underline"
                    >
                      {i.scf_id}
                    </Link>
                  </div>
                  {i.requirement_title && (
                    <p className="mt-1 text-sm text-slate-600">{i.requirement_title}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => act(i, 'confirmed')}
                      disabled={decide.isPending}
                      className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Confirm
                    </button>
                    <button
                      onClick={() => act(i, 'suppressed')}
                      disabled={decide.isPending}
                      className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Suppress
                    </button>
                    <input
                      value={retarget[key] || ''}
                      onChange={(e) => setRetarget((s) => ({ ...s, [key]: e.target.value }))}
                      placeholder="retarget to SCF id"
                      className="w-40 rounded border border-slate-300 px-2 py-1 text-xs font-mono"
                    />
                    <button
                      onClick={() => act(i, 'retargeted')}
                      disabled={decide.isPending || !(retarget[key] || '').trim()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <CornerUpRight className="h-3.5 w-3.5" /> Retarget
                    </button>
                    <input
                      value={note[key] || ''}
                      onChange={(e) => setNote((s) => ({ ...s, [key]: e.target.value }))}
                      placeholder="note (optional)"
                      className="flex-1 min-w-[12rem] rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {data.items.length === 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              Nothing left in the queue{framework ? ` for ${framework}` : ''}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
