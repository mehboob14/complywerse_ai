'use client';

/*
 * ManualChecksPanel — the asset-detail "Manual checks" sub-tab.
 *
 * Surfaces the CIS attestation rules that apply to THIS asset (its OS
 * benchmark + every merged software benchmark) — the human-verified companion
 * to the automated scan. The automated pass-rate deliberately excludes these,
 * so without this tab they'd be invisible.
 *
 * Data: GET /compliance-plugins/asset/{id}/manual-checks
 *   → { total_manual, assessed, not_assessed, benchmarks:[{ benchmark, source,
 *       manual_count, sections:[{ number, label, rule_count, subsections:[
 *       { number, label, rules:[{ id, rule_id, title, severity, status,
 *       note, assessed_at }] }] }] }] }
 * Attest: POST /compliance-plugins/{plugin_id}/runs { asset_id, manual_result }
 *   (compliancePluginsApi.execute) — same per-(plugin,asset) run the backend
 *   already records; refetches this panel on success.
 *
 * Design tokens mirror CompliancePanel (same card/pill/mono language).
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ClipboardCheck, ChevronRight } from 'lucide-react';
import { compliancePluginsApi } from '@/cyber-assurance/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MONO = "font-['ui-monospace','Cascadia_Code',Consolas,monospace] [font-variant-numeric:tabular-nums]";
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const SECLABEL = 'text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#8A95A1]';

type Tone = 'ok' | 'warn' | 'neutral' | 'ac' | 'red' | 'faint';
function Pill({ tone, children, sm }: { tone: Tone; children: React.ReactNode; sm?: boolean }) {
  const map: Record<Tone, string> = {
    ok: 'text-[#1F7A54] bg-[#E7F5EE]',
    warn: 'text-[#9A6410] bg-[#FBF2DF]',
    red: 'text-[#B23A3A] bg-[#FBEAEA]',
    neutral: 'text-[#6B7787] bg-[#F1F4F6]',
    ac: 'text-[#014A81] bg-[#EFF5FA]',
    faint: 'text-[#AEB8C2] bg-[#F5F7F8]',
  };
  return (
    <span className={'inline-flex items-center gap-1 rounded-full font-semibold shrink-0 whitespace-nowrap ' + (sm ? 'text-[9px] px-2 py-px' : 'text-[10.5px] px-[11px] py-[3px]') + ' ' + map[tone]}>
      {children}
    </span>
  );
}

// map an attestation status to a pill
const STATUS_TONE: Record<string, Tone> = { passed: 'ok', failed: 'red', skipped: 'neutral', na: 'neutral', error: 'warn', not_assessed: 'faint' };
const STATUS_LABEL: Record<string, string> = { passed: 'Pass', failed: 'Fail', skipped: 'N/A', na: 'N/A', error: 'Error', not_assessed: 'Not assessed' };

function splitBenchmark(name: string): { title: string; version: string | null } {
  const m = name.match(/^(.*?)[_ ]([vV][\d][\w.]*)$/);
  const title = (m ? m[1] : name).replace(/_/g, ' ').trim();
  return { title, version: m ? m[2] : null };
}

export default function ManualChecksPanel({ asset }: { asset: any }) {
  const qc = useQueryClient();
  const [openSecs, setOpenSecs] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['compliance-plugins', 'manual-checks', asset.id],
    queryFn: () => compliancePluginsApi.assetManualChecks(asset.id).then((r: any) => r.data),
  });

  const attest = useMutation({
    mutationFn: ({ pluginId, result }: { pluginId: number; result: 'pass' | 'fail' | 'na' }) =>
      compliancePluginsApi.execute(pluginId, { asset_id: asset.id, manual_result: result }).then((r: any) => r.data),
    onMutate: (v) => setPending(v.pluginId),
    onSettled: () => setPending(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-plugins', 'manual-checks', asset.id] }),
  });

  const data = q.data;
  const benchmarks: any[] = data?.benchmarks ?? [];
  const pct = useMemo(() => {
    const t = data?.total_manual ?? 0;
    return t ? Math.round(((data?.assessed ?? 0) / t) * 100) : 0;
  }, [data]);

  const wrap = "font-['Poppins',system-ui,sans-serif] text-[#0F1F2B] text-[13.5px] leading-[1.5] flex flex-col gap-3.5";

  if (q.isLoading) {
    return <div className={wrap}><div className="flex items-center gap-2 p-6 text-[13px] text-[#8A95A1]"><Loader2 className="h-4 w-4 animate-spin" /> Loading manual checks…</div></div>;
  }
  if (q.isError) {
    return <div className={wrap}><div className={CARD + ' px-4 py-3 text-[12px] text-[#B23A3A]'}>Couldn&apos;t load manual checks. Try refreshing.</div></div>;
  }
  if (!data || (data.total_manual ?? 0) === 0) {
    return (
      <div className={wrap}>
        <div className={CARD + ' px-[18px] py-5 text-center'}>
          <ClipboardCheck className="mx-auto h-6 w-6 text-[#AEB8C2]" />
          <p className="mt-2 text-[12.5px] text-[#3A4653] font-medium">No manual attestation checks apply to this asset.</p>
          <p className="mt-1 text-[11px] text-[#8A95A1]">Manual checks appear when the asset resolves to a benchmark that contains attestation rules a scanner can&apos;t verify.</p>
        </div>
      </div>
    );
  }

  const toggle = (key: string) =>
    setOpenSecs((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div className={wrap}>
      {/* summary */}
      <article className={CARD + ' px-[18px] py-3.5'}>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="w-9 h-9 rounded-[10px] bg-[#EFF5FA] text-[#014A81] grid place-items-center shrink-0"><ClipboardCheck className="h-[18px] w-[18px]" /></span>
          <div className="flex-1 min-w-[220px]">
            <b className="text-[13px] font-semibold">Manual attestation checks</b>
            <div className="text-[11px] text-[#8A95A1] mt-0.5">
              <span className={MONO}>{data.total_manual}</span> apply · <b className={'text-[#1F7A54] ' + MONO}>{data.assessed}</b> assessed · <b className={'text-[#9A6410] ' + MONO}>{data.not_assessed}</b> outstanding · a human confirms these — they&apos;re not in the automated pass-rate
            </div>
          </div>
          <Pill tone={pct >= 75 ? 'ok' : pct > 0 ? 'warn' : 'faint'}>{pct}% assessed</Pill>
        </div>
        <div className="h-[9px] rounded-full bg-[#EAEEF1] overflow-hidden mt-3">
          <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#005B96,#014A81)' }} />
        </div>
      </article>

      {/* per benchmark → section → subsection → rules */}
      {benchmarks.map((b) => {
        const sb = splitBenchmark(b.benchmark);
        return (
          <article key={b.benchmark} className={CARD}>
            <div className="flex items-center gap-2.5 px-[18px] py-[13px] border-b border-[#F0F3F5] flex-wrap">
              <h4 className="flex-1 min-w-0 text-[13px] font-semibold truncate">
                {sb.title} {sb.version && <span className={MONO + ' font-medium text-[#8A95A1]'}>{sb.version}</span>}
              </h4>
              {b.source && <Pill tone="neutral" sm>{b.source === 'os' ? 'OS benchmark' : 'software'}</Pill>}
              <Pill tone="ac">{b.manual_count} manual</Pill>
            </div>

            {b.sections.map((sec: any) => {
              const key = b.benchmark + '#' + sec.number;
              const open = openSecs.has(key);
              return (
                <div key={key} className="border-b border-[#F0F3F5] last:border-b-0">
                  <button type="button" onClick={() => toggle(key)} className="flex w-full items-center gap-2.5 px-[18px] py-3 text-left hover:bg-[#F7FBFA]">
                    <ChevronRight className="h-3.5 w-3.5 text-[#9BA6B2] transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
                    <span className={SECLABEL + ' !text-[11px] !normal-case !tracking-normal text-[#3A4653] font-semibold flex-1'}>Section {sec.number}</span>
                    <span className="text-[10px] font-semibold text-[#AEB8C2]">{sec.rule_count} rule{sec.rule_count === 1 ? '' : 's'}</span>
                  </button>

                  {open && sec.subsections.map((sub: any) => (
                    <div key={key + '.' + sub.number} className="px-[18px] pb-2">
                      <div className={SECLABEL + ' py-1.5'}>Subsection {sub.number}</div>
                      <div className="flex flex-col gap-1.5">
                        {sub.rules.map((r: any) => {
                          const st = (r.status || 'not_assessed');
                          const busy = pending === r.id && attest.isPending;
                          return (
                            <div key={r.id} className="flex items-start gap-2.5 rounded-[9px] border border-[#EEF1F3] bg-[#FAFBFC] px-3 py-2">
                              <span className={'mt-0.5 shrink-0 rounded-md border border-[#E4E8EC] bg-white px-1.5 py-0.5 text-[9.5px] font-semibold ' + MONO}>{r.rule_id}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] text-[#0F1F2B] [overflow-wrap:anywhere]">{r.title}</div>
                                {r.note && <div className="text-[10.5px] text-[#8A95A1] mt-0.5 [overflow-wrap:anywhere]">{r.note}</div>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Pill tone={STATUS_TONE[st] ?? 'faint'} sm>{STATUS_LABEL[st] ?? st}</Pill>
                                <div className="flex items-center gap-0.5">
                                  {([['pass', '✓', 'ok'], ['fail', '✗', 'red'], ['na', 'N/A', 'neutral']] as const).map(([res, glyph]) => (
                                    <button
                                      key={res}
                                      type="button"
                                      disabled={busy}
                                      onClick={() => attest.mutate({ pluginId: r.id, result: res })}
                                      title={`Mark ${res === 'na' ? 'not applicable' : res}`}
                                      className="h-[22px] min-w-[22px] px-1.5 rounded-[7px] border border-[#E4E8EC] bg-white text-[10.5px] font-semibold text-[#3A4653] hover:bg-[#EFF5FA] hover:text-[#014A81] disabled:opacity-50"
                                    >
                                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : glyph}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </article>
        );
      })}
    </div>
  );
}
