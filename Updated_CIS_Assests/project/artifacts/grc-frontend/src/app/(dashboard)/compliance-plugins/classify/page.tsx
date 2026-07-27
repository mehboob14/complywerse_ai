'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { Brain, Database, CheckCircle2, AlertCircle, Loader2, Play, RotateCcw } from 'lucide-react';

// AI Rule Pre-Classification page
// ------------------------------------------------------------------
// Compliverse stores 4000+ CIS rules across ~25 unique benchmark
// PDFs. At ingest time we tag each rule with the normalised OS keys
// it applies to (windows-11, ubuntu-22.04, cisco-asa, oracle-db-19c …),
// so scan-time lookup is O(1) instead of running regex+AI per request.
//
// This page TRIGGERS the tagging job and STREAMS the AI's reasoning
// live via SSE. Two stages per benchmark:
//   1. Regex matcher — deterministic, instant
//   2. AI router (gpt-4o-mini) — used only when the regex doesn't
//      recognise the benchmark name (e.g. a freshly imported CIS PDF)

type Tick = {
  i: number;
  total: number;
  benchmark: string;
  plugin_count: number;
  keys: string[];
  source: 'regex' | 'ai' | 'unknown';
  reasoning?: string;
};

type Stats = {
  total: number;
  classified: number;
  regex: number;
  ai: number;
  unknown: number;
  unique_benchmarks: number;
  last_run: string | null;
};

export default function RuleClassificationPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ regex: number; ai: number; unknown: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refreshStats = async () => {
    try {
      const r = await fetch('/grc/compliance-plugins/classification-stats', { credentials: 'include' });
      if (r.ok) setStats(await r.json());
    } catch {
      // ignore — backend may be momentarily unreachable
    }
  };

  useEffect(() => {
    refreshStats();
    return () => { esRef.current?.close(); };
  }, []);

  const start = () => {
    setTicks([]);
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    setRunning(true);
    const es = new EventSource('/grc/compliance-plugins/classify-stream', { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => {
      let payload: any;
      try { payload = JSON.parse(e.data); } catch { return; }
      if (payload.phase === 'start') {
        setProgress({ done: 0, total: payload.total });
        return;
      }
      if (payload.phase === 'done') {
        setSummary(payload.by_source);
        setRunning(false);
        es.close();
        refreshStats();
        return;
      }
      if (payload.phase === 'tick') {
        setProgress({ done: payload.i + 1, total: payload.total });
        setTicks((prev) => [payload, ...prev].slice(0, 50));
      }
    };
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  };

  const stop = () => {
    esRef.current?.close();
    setRunning(false);
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const sourceBadge = (source: Tick['source']) => {
    if (source === 'regex') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"><Database className="h-3 w-3" />Regex</span>;
    }
    if (source === 'ai') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"><Brain className="h-3 w-3" />AI</span>;
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"><AlertCircle className="h-3 w-3" />Unknown</span>;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <Brain className="h-6 w-6 text-violet-600" />
          AI Rule Pre-Classification
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Walks every unique CIS benchmark in the rule library and tags it with the normalised OS keys it applies to.
          Tags are persisted on each plugin so scan-time matching is an O(1) lookup — no live AI calls during scans.
          Stage 1 is a deterministic regex matcher; Stage 2 (AI / gpt-4o-mini) handles benchmarks the regex doesn't recognise.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total rules" value={stats?.total} hint="approved + enabled" />
        <StatCard label="Already classified" value={stats?.classified} hint={stats ? `of ${stats.total} total` : ''} accent={stats && stats.classified === stats.total ? 'emerald' : 'slate'} />
        <StatCard label="Unique benchmarks" value={stats?.unique_benchmarks} hint="distinct CIS PDFs" />
        <StatCard label="Last run" value={stats?.last_run ? new Date(stats.last_run).toLocaleString() : 'never'} hint="last classification sweep" isTextValue />
      </div>

      {/* Controls + progress */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Run classification sweep</h2>
            <p className="mt-0.5 text-xs text-slate-500">Re-tags every benchmark. Safe to re-run; results are deterministic when the rule library hasn't changed.</p>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <button
                onClick={stop}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={start}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700"
              >
                {stats?.classified ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {stats?.classified ? 'Re-classify all rules' : 'Run AI classification'}
              </button>
            )}
          </div>
        </div>

        {(running || progress.total > 0) && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {running ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-600" />}{' '}
                Processed {progress.done} / {progress.total} benchmarks
              </span>
              <span className="font-medium">{pct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {summary && (
          <div className="mt-4 grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 md:grid-cols-3">
            <div><strong>{summary.regex}</strong> tagged by regex (instant)</div>
            <div><strong>{summary.ai}</strong> tagged by AI (gpt-4o-mini)</div>
            <div><strong>{summary.unknown}</strong> still unknown — review needed</div>
          </div>
        )}
      </div>

      {/* Live ticker */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Live AI reasoning</h2>
            <p className="text-xs text-slate-500">Most recent benchmark first. Shows the source (regex vs AI) and the OS keys the matcher picked.</p>
          </div>
          {running && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"><Loader2 className="h-3 w-3 animate-spin" />Streaming</span>}
        </div>
        {ticks.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {running ? 'Waiting for first benchmark…' : 'Click "Run AI classification" to start. Each benchmark will stream here as it gets tagged.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ticks.map((t, idx) => (
              <li key={`${t.i}-${idx}`} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className="mt-0.5 font-mono text-[10px] text-slate-400">#{t.i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {sourceBadge(t.source)}
                    <code className="truncate text-xs text-slate-800">{t.benchmark}</code>
                    <span className="text-[10px] text-slate-500">{t.plugin_count} rule{t.plugin_count === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {t.keys.length === 0 ? (
                      <span className="text-[10px] italic text-slate-400">no os keys assigned</span>
                    ) : (
                      t.keys.map((k) => (
                        <span key={k} className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{k}</span>
                      ))
                    )}
                  </div>
                  {t.reasoning && t.source === 'ai' && (
                    <div className="mt-1 text-[11px] italic text-slate-500">{t.reasoning}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label, value, hint, accent = 'slate', isTextValue,
}: {
  label: string;
  value?: number | string | null;
  hint?: string;
  accent?: 'slate' | 'emerald';
  isTextValue?: boolean;
}) {
  const accentText = accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900';
  const display = value === undefined || value === null
    ? '-'
    : typeof value === 'number'
      ? value.toLocaleString()
      : value;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 ${isTextValue ? 'text-sm font-medium' : 'text-2xl font-bold'} ${accentText}`}>{display}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}
