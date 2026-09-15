'use client';

// Automation → Assurance (Stage H). Per-framework indicative coverage + audit
// periods / SoA freeze & export. Compact — not a card dashboard.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Snowflake } from 'lucide-react';
import axios from 'axios';
import {
  scfApi,
  type ScfAuditPeriod,
  type ScfFrameworkStatus,
} from '@/lib/api';

const inputCls =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none';

function errMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const status = err.response?.status;
  if (status === 403) return 'You don’t have permission for this action.';
  if (status === 503) return 'SCF catalog isn’t imported for this tenant yet.';
  if (status === 409) {
    const d = err.response?.data?.detail;
    if (typeof d === 'string') return d;
  }
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return fallback;
}

function pctLabel(v: number | undefined | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Math.round(v)}%`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

function FrameworkRow({ fw }: { fw: ScfFrameworkStatus }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-slate-100 px-3 py-3 last:border-0">
      <div className="min-w-[10rem] flex-1">
        <div className="text-sm font-medium text-slate-800">{fw.label || fw.framework_slug}</div>
        <div className="text-[11px] tabular-nums text-slate-400">
          {fw.applicable_count} applicable · {fw.controls_with_checks} with checks ·{' '}
          {fw.not_assessed_count} not assessed
        </div>
      </div>
      <div className="flex flex-wrap gap-5 text-right">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Automation</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">
            {pctLabel(fw.automation_coverage_pct)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Evidence</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">
            {pctLabel(fw.evidence_coverage_pct)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-amber-600/80">
            Indicative conformity
          </div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">
            {pctLabel(fw.indicative_conformity_pct)}
          </div>
          <div className="text-[10px] text-amber-700/70">not an audit opinion</div>
        </div>
      </div>
    </li>
  );
}

export default function AutomationAssurancePage() {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [soaPeriodId, setSoaPeriodId] = useState<number | ''>('');

  const summaryQ = useQuery({
    queryKey: ['scf-assurance-summary'],
    queryFn: async () => (await scfApi.getAssuranceSummary()).data,
    retry: false,
  });

  const periodsQ = useQuery({
    queryKey: ['scf-audit-periods'],
    queryFn: async () => (await scfApi.listAuditPeriods()).data.periods as ScfAuditPeriod[],
    retry: false,
  });

  const scopeId = summaryQ.data?.scope_id;
  const frameworks = summaryQ.data?.frameworks ?? [];
  const periods = periodsQ.data ?? [];

  const createMut = useMutation({
    mutationFn: () =>
      scfApi.createAuditPeriod({
        name: name.trim(),
        period_start: start,
        period_end: end,
        scope_id: scopeId,
      }),
    onSuccess: () => {
      setName('');
      setStart('');
      setEnd('');
      setBanner('Audit period created.');
      void qc.invalidateQueries({ queryKey: ['scf-audit-periods'] });
    },
    onError: (e) => setBanner(errMessage(e, 'Could not create audit period.')),
  });

  const freezeMut = useMutation({
    mutationFn: (id: number) => scfApi.freezeAuditPeriod(id),
    onSuccess: () => {
      setBanner('SoA frozen onto the audit period.');
      void qc.invalidateQueries({ queryKey: ['scf-audit-periods'] });
    },
    onError: (e) => setBanner(errMessage(e, 'Could not freeze SoA.')),
  });

  const closeMut = useMutation({
    mutationFn: (id: number) => scfApi.closeAuditPeriod(id),
    onSuccess: () => {
      setBanner('Audit period closed.');
      void qc.invalidateQueries({ queryKey: ['scf-audit-periods'] });
    },
    onError: (e) => setBanner(errMessage(e, 'Could not close audit period.')),
  });

  const downloadSoa = async (format: 'json' | 'oscal' | 'xlsx') => {
    if (scopeId == null) {
      setBanner('No scope yet — configure frameworks on Scope first.');
      return;
    }
    try {
      const periodId = soaPeriodId === '' ? undefined : Number(soaPeriodId);
      const res = await scfApi.getSoa(scopeId, { format, periodId });
      const stamp = periodId ? `period-${periodId}` : 'live';
      if (format === 'xlsx') {
        const blob = res.data as Blob;
        const ext = blob.type?.includes('csv') ? 'csv' : 'xlsx';
        downloadBlob(blob, `soa-${stamp}.${ext}`);
      } else {
        downloadJson(res.data, `soa-${stamp}.${format === 'oscal' ? 'oscal.json' : 'json'}`);
      }
      setBanner(null);
    } catch (e) {
      setBanner(errMessage(e, `Could not download SoA (${format}).`));
    }
  };

  if (summaryQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (summaryQ.isError && axios.isAxiosError(summaryQ.error) && summaryQ.error.response?.status === 503) {
    return (
      <div className="mx-auto max-w-2xl px-1 py-8">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Automation</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Assurance</h1>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          SCF catalog isn’t imported for this tenant yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1 py-1">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Automation</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Assurance</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Coverage for in-scope frameworks. Conformity figures are{' '}
          <span className="font-medium text-amber-700">indicative</span> — navigation aids, not an
          audit opinion.
        </p>
      </div>

      {banner && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{banner}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Framework status</h2>
        {frameworks.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No frameworks in scope yet.{' '}
            <Link href="/automation/scope" className="font-semibold text-primary-700 hover:underline">
              Configure scope
            </Link>{' '}
            to see automation, evidence, and indicative conformity.
          </div>
        ) : (
          <ul className="rounded-lg border border-slate-200 bg-white">
            {frameworks.map((fw) => (
              <FrameworkRow key={fw.framework_slug} fw={fw} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Audit periods</h2>
        <p className="text-[12px] text-slate-500">
          Freeze a Statement of Applicability for a period under audit. Recompute stays blocked while
          a period is open or in fieldwork.
        </p>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !start || !end) {
              setBanner('Name and both dates are required.');
              return;
            }
            createMut.mutate();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Name</span>
            <input
              className={`${inputCls} w-44`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FY2026 Type II"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Start</span>
            <input
              type="date"
              className={inputCls}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">End</span>
            <input
              type="date"
              className={inputCls}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
          </button>
        </form>

        {periodsQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading periods…
          </div>
        ) : periods.length === 0 ? (
          <p className="text-sm text-slate-400">No audit periods yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {periods.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{p.name}</div>
                  <div className="text-[11px] tabular-nums text-slate-400">
                    {p.period_start} → {p.period_end} · {p.status}
                    {p.has_soa_snapshot ? ' · SoA frozen' : ''}
                  </div>
                </div>
                {p.status !== 'closed' && (
                  <>
                    <button
                      type="button"
                      disabled={freezeMut.isPending}
                      onClick={() => freezeMut.mutate(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Snowflake className="h-3.5 w-3.5" />
                      Freeze SoA
                    </button>
                    <button
                      type="button"
                      disabled={closeMut.isPending}
                      onClick={() => closeMut.mutate(p.id)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Close
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Download SoA</h2>
        <p className="text-[12px] text-slate-500">
          Live snapshot, or a frozen period after Freeze SoA.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Period (optional)
            </span>
            <select
              className={inputCls}
              value={soaPeriodId === '' ? '' : String(soaPeriodId)}
              onChange={(e) => setSoaPeriodId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Live</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.has_soa_snapshot ? '' : ' (not frozen)'}
                </option>
              ))}
            </select>
          </label>
          {(['json', 'oscal', 'xlsx'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={scopeId == null}
              onClick={() => void downloadSoa(fmt)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {fmt}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
