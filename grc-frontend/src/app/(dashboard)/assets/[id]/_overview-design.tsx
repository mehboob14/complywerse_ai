'use client';

/*
 * AssetOverview — GRC / compliance asset detail (Overview tab).
 * Design handoff, used VERBATIM. The only change from the delivered file is that
 * the inlined demo `ASSET` constant is replaced by an `A` prop, so the exact same
 * UI renders against live API data (see _overview-map.ts for the mapper).
 *
 * Fonts: the design uses "Public Sans" (UI) and "IBM Plex Mono" (technical values).
 * Add them once in app/layout via next/font or a <link>, e.g.
 *   https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap
 */

import React, { useMemo, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// deterministic layout: which deep-inventory sections span full width vs share a row, and their order
const LAYOUT: Record<string, 'half' | 'full'> = { CPU: 'half', Firmware: 'half', Memory: 'half', Storage: 'half', GPU: 'full', 'Microsoft Defender': 'half', BitLocker: 'half', Firewall: 'full', 'Operating System': 'full', 'Windows Update': 'half', 'Scheduled Tasks': 'half', Shares: 'full', Services: 'full', 'Network Adapters': 'full', 'Local Users': 'full', 'Local Groups': 'full' };
const ORDER: Record<string, string[]> = { hardware: ['CPU', 'Firmware', 'Memory', 'Storage', 'GPU'], security: ['Microsoft Defender', 'BitLocker', 'Firewall'], system: ['Operating System', 'Windows Update', 'Scheduled Tasks', 'Shares', 'Services'] };

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e8ecee] rounded-2xl overflow-hidden ${SHADOW}`;
const HOVER = 'transition-[box-shadow,transform] duration-200 hover:shadow-[0_10px_26px_-10px_rgba(18,45,36,0.30)] hover:-translate-y-0.5';
const TONE: Record<string, string> = { ok: '#12a085', warn: '#9a6410', bad: '#b23a3a', muted: '#8a95a1' };

function badgeCls(status: string) {
  const map: Record<string, string> = {
    discovered: 'text-[#12a085] bg-[#e7f5ee] border-[#c3ead2]',
    error: 'text-[#b23a3a] bg-[#fbeaea] border-[#fbeaea]',
    permission_denied: 'text-[#9a6410] bg-[#fbf2df] border-[#fbf2df]',
  };
  return 'text-[9.5px] font-bold tracking-[0.04em] uppercase px-2 py-0.5 rounded-md border ' + (map[status] || 'text-[#3a4653] bg-[#fafbfc] border-[#e8ecee]');
}

function Cell({ label, value, tone, mono }: any) {
  const empty = value === '—' || value === '' || value == null;
  const v = empty ? 'Not set' : value;
  const wide = !empty && typeof v === 'string' && v.length > 24;
  const color = empty ? '#8a95a1' : TONE[tone] || '#0f1f2b';
  return (
    <div className={'min-w-0' + (wide ? ' sm:col-span-2' : '')}>
      <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a95a1] mb-0.5">{label}</div>
      <div className={(mono ? MONO + ' text-[12px]' : 'text-[13px]') + ' break-words leading-snug'} style={{ color, fontStyle: empty ? 'italic' : undefined }}>{v}</div>
    </div>
  );
}

function KV({ items }: { items: any[] }) {
  const inline = items.length <= 2;
  return (
    <div className={inline ? 'flex flex-wrap gap-x-8 gap-y-2' : 'grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-3'}>
      {items.map((it, i) => <Cell key={i} {...it} />)}
    </div>
  );
}

function ObjList({ label, objects }: { label?: string; objects: any[] }) {
  return (
    <div>
      {label && <div className="text-[10px] font-bold tracking-[0.04em] uppercase text-[#3a4653] mb-2">{label}</div>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {objects.map((o, i) => (
          <div key={i} className="border border-[#f0f3f5] bg-[#fafbfc] rounded-lg px-3 py-2.5">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-3.5 gap-y-2">
              {o.map((it: any, j: number) => <Cell key={j} {...it} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ items }: { items: any[] }) {
  return (
    <div className="flex gap-2.5">
      {items.map((it, i) => (
        <div key={i} className="flex-1 bg-[#fafbfc] border border-[#e8ecee] rounded-xl py-3 text-center">
          <div className={'text-[22px] font-extrabold text-[#12a085] leading-none ' + MONO}>{it.value}</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#8a95a1] mt-1.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function SmallTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-[#f0f3f5] rounded-xl overflow-hidden">
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

const TH = 'text-left sticky top-0 bg-[#fafbfc] text-[#3a4653] font-bold text-[10px] tracking-[0.04em] uppercase px-3 py-2 border-b border-[#e8ecee]';
const TD = 'px-3 py-2 border-b border-[#f0f3f5] align-top';

function UsersTable({ rows }: { rows: any[] }) {
  return (
    <SmallTable head={<tr><th className={TH}>Account</th><th className={TH}>SID</th><th className={TH + ' text-center'}>Status</th></tr>}>
      {rows.map((r, i) => {
        const disabled = r[4] === '✓';
        const full = r[0] && r[0] !== '—' ? r[0] : '';
        return (
          <tr key={i}>
            <td className={TD}>
              <div className="font-semibold text-[#0f1f2b]">{r[1]}</div>
              {full && <div className="text-[#8a95a1] text-[11px]">{full}</div>}
            </td>
            <td className={TD + ' text-[#8a95a1] text-[10.5px] break-all ' + MONO}>{r[2]}</td>
            <td className={TD + ' text-center'}>
              <span className={'text-[10px] font-bold uppercase tracking-[0.03em] rounded-md px-2 py-0.5 border ' + (disabled ? 'text-[#8a95a1] bg-[#fafbfc] border-[#e8ecee]' : 'text-[#12a085] bg-[#e7f5ee] border-[#c3ead2]')}>{disabled ? 'Disabled' : 'Enabled'}</span>
            </td>
          </tr>
        );
      })}
    </SmallTable>
  );
}

function GroupsTable({ rows }: { rows: any[] }) {
  return (
    <SmallTable head={<tr><th className={TH + ' w-[38%]'}>Group</th><th className={TH}>Description</th></tr>}>
      {rows.map((r, i) => (
        <tr key={i}>
          <td className={TD + ' font-semibold text-[#0f1f2b]'}>{r[0]}</td>
          <td className={TD + ' text-[#3a4653]'}>{r[1]}</td>
        </tr>
      ))}
    </SmallTable>
  );
}

// Generic table for any kind's big lists (DB databases, router interfaces, cloud
// resources…). Reuses the exact TH/TD styling of the users/groups tables so it
// reads as one system; the first column is emphasised like a name.
function GenericTable({ headers, rows }: { headers: string[]; rows: any[] }) {
  return (
    <SmallTable head={<tr>{headers.map((h, i) => <th key={i} className={TH}>{h}</th>)}</tr>}>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c: any, j: number) => (
            <td key={j} className={TD + (j === 0 ? ' font-semibold text-[#0f1f2b]' : ' text-[#3a4653]')}>{c}</td>
          ))}
        </tr>
      ))}
    </SmallTable>
  );
}

function Block({ b }: { b: any }) {
  if (b.type === 'note') return <div className="text-[12.5px] text-[#8a95a1] italic leading-snug">{b.text}</div>;
  if (b.type === 'kv') return <KV items={b.items} />;
  if (b.type === 'sub') return (<div><div className="text-[10px] font-bold tracking-[0.04em] uppercase text-[#3a4653] mb-2">{b.label}</div><KV items={b.items} /></div>);
  if (b.type === 'objlist') return <ObjList label={b.label} objects={b.objects} />;
  if (b.type === 'stat') return <Stat items={b.items} />;
  if (b.type === 'table' && b.variant === 'users') return <UsersTable rows={b.rows} />;
  if (b.type === 'table' && b.variant === 'groups') return <GroupsTable rows={b.rows} />;
  if (b.type === 'table') return <GenericTable headers={b.headers} rows={b.rows} />;
  return null;
}

function secSummary(sec: any): string {
  if (sec.rows) return `${sec.rows.length} rows`;
  let n = 0;
  for (const b of (sec.blocks || [])) {
    if (b.type === 'table') return `${(b.rows || []).length} rows`;
    if (b.type === 'objlist') n += (b.objects || []).length;
    else if (b.items) n += b.items.length;
  }
  return n ? `${n} field${n === 1 ? '' : 's'}` : (sec.status || '');
}
function SectionCard({ sec }: { sec: any; span?: 'half' | 'full' }) {
  return (
    <details className="group border-t border-[#f0f3f5]">
      <summary className="list-none cursor-pointer select-none flex items-center gap-2.5 px-3.5 py-[7px] hover:bg-[#f7fbfa]">
        <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0 text-[#aeb8c2] transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        <span className="text-[11.5px] font-semibold text-[#0f1f2b] flex-1 min-w-0">{sec.title}</span>
        <span className="text-[10.5px] text-[#aeb8c2] whitespace-nowrap ml-2">{secSummary(sec)}</span>
      </summary>
      <div className="px-3.5 pb-3 pt-0.5 flex flex-col gap-3.5">
        {(sec.blocks || []).map((b: any, i: number) => <Block key={i} b={b} />)}
      </div>
    </details>
  );
}

function ProvenanceCard({ card, accent, kind, full }: { card: any; accent: string; kind: 'machine' | 'manual'; full?: boolean }) {
  const setCount = kind === 'manual' ? card.fields.filter((f: any) => f.value !== '—' && f.value !== '' && f.value != null).length : 0;
  return (
    <div className={CARD + ' ' + HOVER + ' border-l-[3px] ' + accent + (full ? ' lg:col-span-2' : '')}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-[15px] border-b border-[#f0f3f5]">
        <div className="text-[14px] font-bold text-[#0f1f2b]">{card.title}</div>
        {kind === 'machine'
          ? <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase text-[#12a085] bg-[#e7f5ee] border border-[#c3ead2] px-2.5 py-[3px] rounded-full">{card.note}</span>
          : <a onClick={card.onEdit} className="text-[12px] font-semibold text-[#12a085] cursor-pointer">Edit</a>}
      </div>
      <div className="px-[18px] py-4">
        {kind === 'manual' && (
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex-1 h-1.5 bg-[#f4f6f7] rounded-full overflow-hidden"><div className="h-full bg-[#e2b33c]" style={{ width: (card.complete != null ? card.complete : Math.round((setCount / card.fields.length) * 100)) + '%' }} /></div>
            <span className="text-[11px] font-bold text-[#c79a3a] whitespace-nowrap">{setCount} of {card.fields.length} set</span>
          </div>
        )}
        {card.tiles && (
          <div className="flex gap-2.5 mb-4">
            {card.tiles.map((t: any, i: number) => (
              <div key={i} className="flex-1 bg-[#fafbfc] border border-[#e8ecee] rounded-xl py-3 text-center">
                <div className={'text-[24px] font-extrabold text-[#12a085] leading-none ' + MONO}>{t.num}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#8a95a1] mt-1.5">{t.label}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-3.5">
          {card.fields.map((f: any, i: number) => <Cell key={i} {...f} />)}
        </div>
      </div>
    </div>
  );
}

export default function AssetOverview({ A }: { A: any }) {
  // Default to the first collected domain — 'hardware' for a host, 'instance' for
  // a database, 'account' for cloud, etc. — so the correct tab is highlighted.
  const [deepTab, setDeepTab] = useState<string>(() => A.deep?.[0]?.key || 'hardware');
  const [swQuery, setSwQuery] = useState('');
  const [svcQuery, setSvcQuery] = useState('');
  const [svcState, setSvcState] = useState<'all' | 'running' | 'stopped'>('all');
  // Which KPI tile has its breakdown open (only the hygiene tile carries one).
  const [openKpi, setOpenKpi] = useState<number | null>(null);

  const software = useMemo(() => {
    const q = swQuery.trim().toLowerCase();
    const rows = A.security.software;
    return q ? rows.filter((p: any) => (p.name + ' ' + p.version).toLowerCase().includes(q)) : rows;
  }, [A, swQuery]);

  const group = A.deep.find((g: any) => g.key === deepTab) || A.deep[0] || { key: 'hardware', sections: [] };
  const deepSections = useMemo(() => {
    const order = ORDER[group.key];
    const secs = order ? [...group.sections].sort((a: any, b: any) => (order.indexOf(a.title) < 0 ? 99 : order.indexOf(a.title)) - (order.indexOf(b.title) < 0 ? 99 : order.indexOf(b.title))) : group.sections;
    return secs;
  }, [group]);

  const svcSection = useMemo(() => (A.deep.find((g: any) => g.key === 'system') || { sections: [] }).sections.find((s: any) => s.variant === 'services'), [A]);
  const svc = useMemo(() => {
    if (!svcSection) return { rows: [], run: 0, stop: 0, total: 0 };
    const rows = svcSection.rows;
    const run = rows.filter((r: any) => r[4] === 'Running').length;
    const stop = rows.filter((r: any) => r[4] === 'Stopped').length;
    const q = svcQuery.trim().toLowerCase();
    let f = rows;
    if (svcState === 'running') f = f.filter((r: any) => r[4] === 'Running');
    else if (svcState === 'stopped') f = f.filter((r: any) => r[4] === 'Stopped');
    if (q) f = f.filter((r: any) => (r[1] + ' ' + r[5] + ' ' + r[0] + ' ' + r[2]).toLowerCase().includes(q));
    return { rows: f, run, stop, total: rows.length };
  }, [svcSection, svcQuery, svcState]);

  const spanOf = (sec: any): 'half' | 'full' => {
    const blocks = sec.blocks || [];
    const wide = sec.variant === 'services' || blocks.some((b: any) => b.type === 'table') || blocks.some((b: any) => b.type === 'objlist' && (b.objects || []).length >= 3);
    return LAYOUT[sec.title] || (wide ? 'full' : 'half');
  };

  const DOMS = useMemo(() => {
    // External / outside-in assets (domains, EASM) have a different telemetry
    // shape. The mapper (buildExternalDeep) already groups external_probe into
    // ordered Domain & DNS / Web, TLS & Exposure / Infrastructure groups — consume
    // them straight so the pills read in that exact order. `pill` = short jump-bar
    // label; `label` = the longer telemetry header.
    if (A.external) {
      return A.deep
        .filter((g: any) => (g.sections || []).length > 0)
        .map((g: any) => ({ key: g.key, label: g.label, pill: g.pill || g.label, sub: g.sub, secs: g.sections }));
    }
    const sortedOf = (k: string, titles: string[]) => {
      const g = A.deep.find((x: any) => x.key === k);
      if (!g) return [];
      return [...g.sections].sort((a: any, b: any) => (titles.indexOf(a.title) < 0 ? 99 : titles.indexOf(a.title)) - (titles.indexOf(b.title) < 0 ? 99 : titles.indexOf(b.title)));
    };
    const HW = ['Machine identity', 'Compute · CPU', 'Memory', 'GPU', 'Storage', 'Network interfaces', 'Firmware'];
    const SW = ['Operating system', 'Updates & patching', 'Services', 'Scheduled tasks', 'Shares'];
    const SEC = ['Endpoint protection', 'EDR / XDR', 'EDR', 'Antivirus', 'BitLocker', 'Defender', 'Firewall', 'Local users', 'Users', 'Local groups', 'Groups'];
    const known = ['hardware', 'network', 'system', 'security', 'accountsaccess'];
    const extras = A.deep.filter((g: any) => known.indexOf(g.key) < 0).flatMap((g: any) => g.sections || []);
    const doms = [
      { key: 'hardware', label: 'Hardware Telemetry', sub: 'Machine identity, compute, storage, network interfaces & firmware · agentless scan', secs: [...sortedOf('hardware', HW), ...sortedOf('network', HW)] },
      { key: 'software', label: 'Software Telemetry', sub: 'Operating system, updates, services & system configuration · agentless scan', secs: [...sortedOf('system', SW), ...extras] },
      { key: 'security', label: 'Security Telemetry', sub: 'Endpoint protection, encryption, firewall & accounts', secs: [...sortedOf('security', SEC), ...sortedOf('accountsaccess', SEC)] },
    ];
    return doms.filter((d) => d.secs.length > 0);
  }, [A]);

  return (
    <div className="inv2" style={{ fontSize: 13.5 }}>
      {/* provenance legend + collection line */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mx-0.5 mb-2 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#17b898]" /><span className="text-[#8a95a1]">Machine-collected</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#e2b33c]" /><span className="text-[#8a95a1]">Manual · CMDB</span></span>
        <span className="ml-auto text-[#aeb8c2]">{A.deep.reduce((n: number, g: any) => n + g.sections.length, 0)} machine-collected sections across {A.deep.length} domains{A.legend?.machine ? ` · ${A.legend.machine}` : ''}</span>
      </div>

      {/* KPI strip â one compact card, cells divided */}
      <div className={CARD + ' mb-2.5 flex flex-wrap'}>
        {A.kpis.map((k: any, i: number) => {
          const col = k.tone === 'muted' ? '#8a95a1' : TONE[k.tone] || '#0f1f2b';
          const openable = Array.isArray(k.breakdown) && k.breakdown.length > 0;
          const isOpen = openKpi === i;
          return (
            <div key={i} onClick={openable ? () => setOpenKpi(isOpen ? null : i) : undefined}
              className={'flex-1 min-w-[104px] px-3 py-1.5 border-r border-[#f0f3f5] last:border-r-0 ' + (openable ? 'cursor-pointer hover:bg-[#fafbfc]' : '')}>
              <div className="text-[10px] text-[#8a95a1] whitespace-nowrap">{k.label}{openable && <span className="ml-1 text-[10px] text-[#2e63a8]">{isOpen ? '▴' : '▾'}</span>}</div>
              <div className={'text-[18px] font-bold leading-none mt-0.5 ' + MONO} style={{ color: k.tone ? col : '#0f1f2b' }}>{k.value}</div>
              {k.bar != null && <div className="h-[4px] bg-[#f0f3f5] rounded-full mt-1.5 overflow-hidden"><div className="h-full" style={{ width: (k.bar || 2) + '%', background: k.tone === 'warn' ? '#e2b33c' : '#17b898' }} /></div>}
              <div className="text-[9.5px] mt-0.5" style={{ color: k.tone === 'ok' ? '#1f7a54' : k.tone === 'warn' ? '#9a6410' : '#aeb8c2' }}>{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Hygiene breakdown â revealed only when its KPI cell is clicked. */}
      {openKpi != null && Array.isArray(A.kpis[openKpi]?.breakdown) && (() => {
        const k = A.kpis[openKpi];
        return (
          <div className="rounded-2xl border-2 border-[#2e63a8] bg-[#e9f1fb] p-[16px] mb-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-bold text-[#0f1f2b]">{k.breakdownTitle || 'Score breakdown'}</div>
                {k.breakdownNote && <p className="mt-0.5 text-[11.5px] text-[#3a4653] max-w-3xl">{k.breakdownNote}</p>}
              </div>
              <button onClick={() => setOpenKpi(null)} className="text-[11.5px] font-semibold text-[#2e63a8] whitespace-nowrap">Close ✕</button>
            </div>
            <div className="mt-3 space-y-2">
              {k.breakdown.map((r: any, i: number) => {
                const na = r.applicable === false;
                const pct = Math.max(0, Math.min(100, r.pct ?? 0));
                const bar = r.tone === 'ok' ? '#1f7a54' : r.tone === 'warn' ? '#e2b33c' : '#b23a3a';
                return (
                  <div key={i} className={'flex items-center gap-3' + (na ? ' opacity-60' : '')}>
                    <div className="w-52 flex-none">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0f1f2b]">
                        {r.label}
                        {r.weightPct != null
                          ? <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#3a4653]">{r.weightPct}%</span>
                          : <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a95a1]">N/A</span>}
                      </div>
                      <div className="text-[10.5px] text-[#8a95a1]">{r.value}</div>
                    </div>
                    {na ? (
                      <div className="flex-1 text-[10.5px] italic text-[#aeb8c2]">not counted in the score</div>
                    ) : (
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                        <div className="h-full rounded-full" style={{ width: Math.max(2, pct) + '%', background: bar }} />
                      </div>
                    )}
                    <div className={'w-10 flex-none text-right text-[12px] font-semibold tabular-nums text-[#0f1f2b] ' + MONO}>{na ? '—' : pct}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* domain jump pills */}
      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {DOMS.map((g: any) => (
          <button key={g.key} onClick={() => document.getElementById('dom-' + g.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-white text-[#3a4653] border border-[#e8ecee] hover:border-[#17b898] whitespace-nowrap">{g.pill || g.label}</button>
        ))}
        {A.manual.length > 0 && (
          <button onClick={() => document.getElementById('dom-manual')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-white text-[#3a4653] border border-[#e8ecee] hover:border-[#17b898] whitespace-nowrap">Ownership &amp; Context</button>
        )}
      </div>

      {/* access / absence notes */}
      {(A.deepNote?.denied?.length > 0 || A.deepNote?.absent?.length > 0) && (
        <div className="mb-3.5 space-y-1.5">
          {A.deepNote.denied?.length > 0 && (
            <div className="rounded-xl border border-[#ead9ae] bg-[#fbf7ec] px-3.5 py-2.5 text-[11.5px] text-[#7a6427]">
              <b>Needs elevated access</b> (root / sudo): {A.deepNote.denied.join(' · ')}.
            </div>
          )}
          {A.deepNote.absent?.length > 0 && (
            <div className="text-[11.5px] text-[#8a95a1] px-1">Not present on this host: {A.deepNote.absent.join(' · ')}.</div>
          )}
        </div>
      )}

      {/* External host with no outside-in data yet — honest callout, not blank cards. */}
      {A.external && DOMS.length === 0 && (
        <div className="rounded-2xl border border-[#ead9ae] bg-[#fbf7ec] px-4 py-3.5 mb-2.5 text-[12px] text-[#7a6427]">
          <b>No outside-in data collected yet.</b> Run <b>Rescan domain</b> to probe DNS, TLS, HTTP posture and email security for this host — telemetry appears here once the crawl completes.
        </div>
      )}

      {/* ALL telemetry domains, stacked */}
      {DOMS.map((g: any) => {
        const secs = g.secs;
        const hasSvc = g.key === 'software';
        const sub = g.sub;
        const badRev = (A.security.signals || []).filter((x: any) => x.tone === 'bad').length;
        const badge = g.key === 'hardware' ? (A.legend?.machine || '')
          : hasSvc ? `${svc.total} services · ${A.security.software.length} packages`
          : g.key === 'security' && badRev > 0 ? `${badRev} items to review` : '';
        const tile = g.key === 'hardware' ? ['#e9f1fb', '#2e63a8'] : g.key === 'security' ? ['#fbeaea', '#b23a3a'] : ['#eeebfa', '#6a54c9'];
        return (
          <section key={g.key} id={'dom-' + g.key} className={CARD + ' mb-2.5 scroll-mt-16 overflow-hidden'}>
            <div className="flex items-center gap-3 px-3.5 py-2 bg-[#fafbfc]">
              <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-none" style={{ background: tile[0], color: tile[1] }}>
                {g.key === 'hardware'
                  ? <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M12 16v4" /></svg>
                  : g.key === 'security'
                    ? <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" /></svg>
                    : <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5v8" /><path d="M3 8v8l9 5 9-5" /></svg>}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-bold text-[#0f1f2b]">{g.label}</div>
                {sub && <div className="text-[10px] text-[#8a95a1]">{sub}</div>}
              </div>
              {badge && <span className="text-[10px] font-semibold text-[#0a5a4b] bg-[#e4f8f2] border border-[#c3ead2] rounded-full px-2 py-[2px] whitespace-nowrap inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#17b898]" />{badge}</span>}
            </div>
            <div>
              {secs.map((sec: any, i: number) => {
                if (sec.variant === 'services') {
                  const chip = (key: 'all' | 'running' | 'stopped', lbl: string) => (
                    <button onClick={() => setSvcState(key)} className={'text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap border ' + (svcState === key ? 'bg-[#12a085] text-white border-[#12a085]' : 'bg-white text-[#3a4653] border-[#e8ecee]')}>{lbl}</button>
                  );
                  return (
                    <details key={i} className="group border-t border-[#f0f3f5]">
                      <summary className="list-none cursor-pointer select-none flex items-center gap-2.5 px-3.5 py-[7px] hover:bg-[#f7fbfa]">
                        <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0 text-[#aeb8c2] transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                        <span className="text-[11.5px] font-semibold text-[#0f1f2b] flex-1 min-w-0">{sec.title}</span>
                        <span className="text-[10.5px] text-[#aeb8c2] whitespace-nowrap ml-2">{svc.total} · {svc.run} running</span>
                      </summary>
                      <div className="px-3.5 pb-3">
                        <div className="flex flex-wrap gap-2 items-center mb-3">
                          <input value={svcQuery} onChange={(e) => setSvcQuery(e.target.value)} placeholder="Search services…" className="flex-1 min-w-[220px] text-[12.5px] px-3 py-[7px] border border-[#e8ecee] rounded-lg bg-[#fafbfc] outline-none focus:border-[#12a085]" />
                          <div className="flex gap-1.5">{chip('all', 'All ' + svc.total)}{chip('running', 'Running ' + svc.run)}{chip('stopped', 'Stopped ' + svc.stop)}</div>
                        </div>
                        <div className="border border-[#f0f3f5] rounded-xl overflow-hidden">
                          <div className="max-h-[430px] overflow-auto">
                            <table className="w-full border-collapse text-[12px]">
                              <thead><tr><th className={TH}>Service</th><th className={TH}>State</th><th className={TH}>Start</th><th className={TH}>Account</th></tr></thead>
                              <tbody>
                                {svc.rows.map((r: any, j: number) => {
                                  const running = r[4] === 'Running';
                                  return (
                                    <tr key={j}>
                                      <td className={TD}><div className={'font-semibold text-[#0f1f2b] text-[11.5px] ' + MONO}>{r[1]}</div><div className="text-[#8a95a1] text-[11px] mt-px">{r[5]}</div></td>
                                      <td className={TD}><span className={'inline-block text-[10.5px] rounded-md px-2 py-0.5 border ' + (running ? 'font-bold text-[#12a085] bg-[#e7f5ee] border-[#c3ead2]' : 'font-semibold text-[#8a95a1] bg-[#fafbfc] border-[#e8ecee]')}>{r[4]}</span></td>
                                      <td className={TD + ' text-[#3a4653]'}>{r[3]}</td>
                                      <td className={TD + ' text-[#3a4653] text-[11px]'}>{r[0]}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        {svc.rows.length === 0 && <div className="py-4 text-center text-[#aeb8c2] text-[12px]">No services match.</div>}
                      </div>
                    </details>
                  );
                }
                return <SectionCard key={i} sec={sec} />;
              })}
              {hasSvc && A.security.software.length > 0 && (
                <details className="group border-t border-[#f0f3f5]">
                  <summary className="list-none cursor-pointer select-none flex items-center gap-2.5 px-3.5 py-[7px] hover:bg-[#f7fbfa]">
                    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0 text-[#aeb8c2] transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    <span className="text-[11.5px] font-semibold text-[#0f1f2b] flex-1 min-w-0">Installed packages</span>
                    <span className="text-[10.5px] text-[#aeb8c2] whitespace-nowrap ml-2">{A.security.software.length} packages</span>
                  </summary>
                  <div className="px-3.5 pb-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
                      <input value={swQuery} onChange={(e) => setSwQuery(e.target.value)} placeholder="Search packages…" className="w-full sm:w-[260px] text-[12.5px] px-3 py-[7px] border border-[#e8ecee] rounded-lg bg-[#fafbfc] outline-none focus:border-[#12a085]" />
                    </div>
                    <div className="border border-[#f0f3f5] rounded-xl overflow-hidden">
                      <div className="max-h-[320px] overflow-auto">
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead><tr><th className={TH + ' text-[10.5px] px-3.5 py-[9px]'}>Package</th><th className={TH + ' text-[10.5px] px-3.5 py-[9px] w-[160px]'}>Version</th><th className={TH + ' text-[10.5px] px-3.5 py-[9px] w-[150px]'}>Tracked</th></tr></thead>
                          <tbody>
                            {software.map((p: any, i: number) => {
                              const setup = p.tracked && p.tracked.indexOf('set up') >= 0;
                              const dash = !p.tracked || p.tracked === '—';
                              return (
                                <tr key={i} onClick={p.onClick} className={p.onClick ? 'cursor-pointer hover:bg-[#fafbfc]' : undefined}>
                                  <td className="px-3.5 py-2 border-b border-[#f0f3f5] text-[#0f1f2b] font-medium">{p.name}</td>
                                  <td className={'px-3.5 py-2 border-b border-[#f0f3f5] text-[#3a4653] text-[11.5px] ' + MONO}>{p.version}</td>
                                  <td className="px-3.5 py-2 border-b border-[#f0f3f5]"><span className={setup ? 'text-[11.5px] font-semibold text-[#12a085] cursor-pointer' : dash ? 'text-[#aeb8c2]' : 'text-[11.5px] font-semibold text-[#12a085]'}>{dash ? '—' : p.tracked}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {software.length === 0 && <div className="py-6 text-center text-[#aeb8c2] text-[12.5px]">No packages match “{swQuery}”.</div>}
                    </div>
                    <div className="text-[11px] text-[#aeb8c2] mt-2">Full posture summary & SBOM export live in the Software tab →</div>
                  </div>
                </details>
              )}
            </div>
          </section>
        );
      })}

      {/* Ownership & Business Context â manually maintained cards */}
      {A.manual.length > 0 && (
        <section id="dom-manual" className={CARD + ' mb-2.5 scroll-mt-16 overflow-hidden'}>
          <div className="flex items-center gap-3 px-3.5 py-2 bg-[#fafbfc]">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-none" style={{ background: '#fbf2df', color: '#9a6410' }}>
              <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold text-[#0f1f2b]">Ownership &amp; Context</div>
              <div className="text-[10px] text-[#8a95a1]">Ownership, business context, procurement & collection · manually maintained</div>
            </div>
          </div>
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-stretch">
            {A.manual.map((c: any, i: number) => <ProvenanceCard key={i} card={c} accent="border-l-[#e2b33c]" kind="manual" full />)}
          </div>
        </section>
      )}

      <div className="text-center text-[#aeb8c2] text-[10.5px] mt-4">Overview · {A.header.name} · all figures reflect the latest {A.external ? 'outside-in probe' : 'agentless collection'}</div>
    </div>
  );
}
