'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ArrowLeft, CheckCircle2, Flag, X, ShieldCheck } from 'lucide-react';

interface Member {
  parsed_control_id: number;
  framework: string;
  code: string;
  title: string;
  text: string;
}
interface ReviewItem {
  id: number;
  code: string;
  name: string;
  review_status: string;
  framework_count: number;
  member_count: number;
  members: Member[];
}
interface QueueResponse {
  items: ReviewItem[];
  total: number;
  counts: Record<string, number>;
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  flagged: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function MasterListReviewPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ['review-queue', filter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (filter) params.review_status = filter;
      return (await apiClient.get('/control-library/groups/review/queue', { params })).data as QueueResponse;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['review-queue'] });
  const approve = useMutation({
    mutationFn: (id: number) => apiClient.post(`/control-library/groups/review/${id}/approve`),
    onSuccess: invalidate,
  });
  const flag = useMutation({
    mutationFn: (id: number) => apiClient.post(`/control-library/groups/review/${id}/flag`),
    onSuccess: invalidate,
  });
  const removeMember = useMutation({
    mutationFn: ({ id, pid }: { id: number; pid: number }) =>
      apiClient.post(`/control-library/groups/review/${id}/remove-member`, { parsed_control_id: pid }),
    onSuccess: invalidate,
  });

  const counts = data?.counts || {};
  const total = (counts.pending || 0) + (counts.approved || 0) + (counts.flagged || 0);
  const approvedPct = total ? Math.round(((counts.approved || 0) / total) * 100) : 0;

  const tabs: Array<{ key: string | undefined; label: string; n: number }> = [
    { key: undefined, label: 'All', n: total },
    { key: 'pending', label: 'Pending', n: counts.pending || 0 },
    { key: 'flagged', label: 'Flagged', n: counts.flagged || 0 },
    { key: 'approved', label: 'Approved', n: counts.approved || 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/control-library" className="text-slate-400 hover:text-slate-700">
            <ArrowLeft size={20} />
          </Link>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 shadow-sm">
            <ShieldCheck className="h-6 w-6 text-white" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Master List Review</h1>
            <p className="text-sm text-slate-500">
              Approve correct unified controls or remove a wrong member — drive the library to 100% correct.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center">
          <div className="text-2xl font-bold text-primary-700">{approvedPct}%</div>
          <div className="text-xs text-slate-500">{counts.approved || 0} / {total} approved</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.label}
            onClick={() => setFilter(t.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              filter === t.key
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label} <span className="ml-1 text-xs text-slate-400">{t.n}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center text-slate-400">
          Nothing here.
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((nc) => (
            <div key={nc.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{nc.code}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[nc.review_status] || STATUS_STYLES.pending}`}>
                      {nc.review_status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{nc.name}</h3>
                  <p className="text-xs text-slate-500">
                    {nc.member_count} controls · {nc.framework_count} frameworks
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => approve.mutate(nc.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 size={16} /> Approve
                  </button>
                  <button
                    onClick={() => flag.mutate(nc.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
                  >
                    <Flag size={16} /> Flag
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {nc.members.map((m) => (
                  <div
                    key={m.parsed_control_id}
                    className="group flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-slate-500">{m.framework} · {m.code}</span>
                      <p className="truncate text-sm text-slate-700" title={m.title}>{m.title}</p>
                    </div>
                    <button
                      onClick={() => removeMember.mutate({ id: nc.id, pid: m.parsed_control_id })}
                      title="Remove this control — it does not belong here"
                      className="mt-0.5 shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
